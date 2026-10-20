import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { connectDatabases } from "@gestaloka/server";
import { OryIdentity } from "@gestaloka/server/identity";
import { Operations } from "@gestaloka/server/operations";
import type { Operation } from "@gestaloka/contracts";
import type { z } from "zod";
import { createApp } from "../../apps/api/src/app.js";

const root = connectDatabases(),
  key = "1".repeat(64);
let db: ReturnType<typeof connectDatabases>,
  ops: Operations,
  identity: OryIdentity,
  app: Awaited<ReturnType<typeof createApp>>,
  schema: string,
  testUrl: string;
const cookies = new Map<string, string>();
beforeEach(async () => {
  schema = "ops_test_" + randomUUID().replaceAll("-", "");
  await root.postgres.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${schema}`);
  testUrl = url.toString();
  db = connectDatabases({ ...process.env, DATABASE_URL: testUrl });
  cookies.clear();
  identity = new OryIdentity(
    db.postgres,
    "http://ory.invalid",
    async (_url, options) => {
      const id = cookies.get(new Headers(options?.headers).get("cookie") ?? "");
      return id
        ? Response.json({
            id: randomUUID(),
            active: true,
            expires_at: new Date(Date.now() + 60000).toISOString(),
            identity: { id, state: "active", traits: { role: "admin" } },
          })
        : new Response(null, { status: 401 });
    },
  );
  await identity.setup();
  ops = new Operations(db.postgres, key);
  await ops.setup();
  app = await createApp(undefined, identity, undefined, ops);
});
afterEach(async () => {
  await app?.close();
  await db?.close();
  await root.postgres.query(`DROP SCHEMA ${schema} CASCADE`);
});
afterAll(() => root.close());
async function person() {
  const id = randomUUID(),
    ory = randomUUID(),
    cookie = `ory_test=${randomUUID()}`;
  await db.postgres.query("INSERT INTO app_identity(id,ory_id) VALUES($1,$2)", [
    id,
    ory,
  ]);
  cookies.set(cookie, ory);
  return { id, cookie };
}
const run = (
  actor: string,
  input: z.infer<typeof Operation>,
  request = randomUUID(),
) => ops.execute(actor, request, input);
async function founder() {
  const actor = await person();
  await run(actor.id, { operation: "account.register" });
  return actor;
}
async function join(admin: string) {
  const created = await run(admin, {
    operation: "invites.create",
    maxUses: 1,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    reason: "test",
  });
  const actor = await person();
  await run(actor.id, {
    operation: "account.register",
    invitation: created.token as string,
  });
  return actor;
}

test("同時登録でも初代管理者は一度だけ成立し、再送・再起動で増えず、その後は招待必須", async () => {
  const actors = await Promise.all(Array.from({ length: 8 }, person));
  const outcomes = await Promise.allSettled(
    actors.map((a) => run(a.id, { operation: "account.register" })),
  );
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (await db.postgres.query("SELECT * FROM app_user")).rows,
  ).toMatchObject([{ role: "admin", banned: false }]);
  const first = actors[outcomes.findIndex((r) => r.status === "fulfilled")]!;
  const again = new Operations(db.postgres, key);
  await again.setup();
  await again.execute(first.id, randomUUID(), {
    operation: "account.register",
  });
  expect(await ops.state(first.id)).toMatchObject({
    inviteRequired: true,
    bootstrapAvailable: false,
  });
  expect(
    Number(
      (await db.postgres.query("SELECT count(*) FROM app_user")).rows[0].count,
    ),
  ).toBe(1);
});

test("追加管理者も任命でき、一般ユーザーは拒否され、最後の有効な管理者を保護する", async () => {
  const first = await founder(),
    second = await join(first.id),
    third = await join(first.id),
    user = await join(first.id);
  await run(first.id, {
    operation: "users.role",
    userId: second.id,
    role: "admin",
    reason: "任命",
  });
  await run(second.id, {
    operation: "users.role",
    userId: third.id,
    role: "admin",
    reason: "追加管理者から任命",
  });
  await expect(
    run(user.id, {
      operation: "users.role",
      userId: user.id,
      role: "admin",
      reason: "自己申告",
    }),
  ).rejects.toMatchObject({ status: 403, code: "ADMIN_REQUIRED" });
  const changes = await Promise.allSettled(
    [first, second, third].map((a) =>
      run(third.id, {
        operation: "users.role",
        userId: a.id,
        role: "user",
        reason: "同時降格",
      }),
    ),
  );
  expect(changes.some((r) => r.status === "fulfilled")).toBe(true);
  const remaining = (
    await db.postgres.query(
      "SELECT id FROM app_user WHERE role='admin' AND NOT banned",
    )
  ).rows;
  expect(remaining.length).toBeGreaterThan(0);
  const last = remaining[0]!.id;
  for (const other of remaining.slice(1))
    await run(last, {
      operation: "users.role",
      userId: other.id,
      role: "user",
      reason: "最後の管理者を残す",
    });
  await expect(
    run(last, {
      operation: "users.ban",
      userId: last,
      banned: true,
      reason: "最後の管理者",
    }),
  ).rejects.toMatchObject({ code: "LAST_ADMIN" });
  expect((await ops.state(last)).member).toMatchObject({
    role: "admin",
    banned: false,
  });
});

test("BAN・権限剥奪は成功済み要求の再送にも適用され、復旧CLIは監査付きで管理者を復旧する", async () => {
  const first = await founder(),
    second = await join(first.id);
  await run(first.id, {
    operation: "users.role",
    userId: second.id,
    role: "admin",
    reason: "任命",
  });
  const id = randomUUID();
  await run(first.id, { operation: "settings.read" }, id);
  await run(second.id, {
    operation: "users.ban",
    userId: first.id,
    banned: true,
    reason: "停止",
  });
  await expect(
    run(first.id, { operation: "settings.read" }, id),
  ).rejects.toMatchObject({ code: "USER_BANNED" });
  await expect(
    run(first.id, { operation: "account.register" }),
  ).rejects.toMatchObject({ code: "USER_BANNED" });
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/recover-admin.ts", first.id, "保守による復旧"],
    {
      env: {
        ...process.env,
        DATABASE_URL: testUrl,
        OPERATIONS_TOKEN_SECRET: key,
      },
      encoding: "utf8",
    },
  );
  expect(JSON.parse(output).result.member).toMatchObject({
    id: first.id,
    role: "admin",
    banned: false,
  });
  expect(
    (
      await db.postgres.query(
        "SELECT actor_id,details FROM operation_audit WHERE operation='recovery.admin'",
      )
    ).rows[0],
  ).toMatchObject({ actor_id: null, details: { reason: "保守による復旧" } });
  await run(second.id, {
    operation: "users.role",
    userId: first.id,
    role: "user",
    reason: "降格",
  });
  await expect(
    run(first.id, { operation: "settings.read" }, id),
  ).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
});

test("招待の上限・期限・失効をサーバーで判定し、同時利用・登録再送で重複消費しない", async () => {
  const admin = await founder();
  const inviteId = randomUUID(),
    command = {
      operation: "invites.create",
      maxUses: 1,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      reason: "同時招待",
    } as const;
  const invite = await run(admin.id, command, inviteId);
  expect(
    await new Operations(db.postgres, key).execute(admin.id, inviteId, command),
  ).toEqual(invite);
  const actors = await Promise.all(Array.from({ length: 5 }, person));
  const outcomes = await Promise.allSettled(
    actors.map((a) =>
      run(a.id, {
        operation: "account.register",
        invitation: invite.token as string,
      }),
    ),
  );
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const winner = actors[outcomes.findIndex((r) => r.status === "fulfilled")]!;
  await run(winner.id, {
    operation: "account.register",
    invitation: invite.token as string,
  });
  expect(
    Number(
      (
        await db.postgres.query("SELECT uses FROM app_invite WHERE id=$1", [
          invite.id,
        ])
      ).rows[0].uses,
    ),
  ).toBe(1);
  const expired = await run(admin.id, command);
  await db.postgres.query(
    "UPDATE app_invite SET expires_at=now()-interval '1 second' WHERE id=$1",
    [expired.id],
  );
  await expect(
    run((await person()).id, {
      operation: "account.register",
      invitation: expired.token as string,
    }),
  ).rejects.toMatchObject({ code: "INVITATION_REQUIRED" });
  const revoked = await run(admin.id, command);
  await run(admin.id, {
    operation: "invites.revoke",
    inviteId: revoked.id as string,
    reason: "失効",
  });
  await expect(
    run((await person()).id, {
      operation: "account.register",
      invitation: revoked.token as string,
    }),
  ).rejects.toMatchObject({ code: "INVITATION_REQUIRED" });
  await run(admin.id, {
    operation: "settings.invites",
    enabled: false,
    reason: "一般登録を許可",
  });
  expect(
    (await run((await person()).id, { operation: "account.register" })).member,
  ).toMatchObject({ role: "user" });
});

test("監査は成功・拒否・再送・衝突を区別し、招待秘密値と一覧本文を複製しない", async () => {
  const admin = await founder(),
    user = await person(),
    request = randomUUID();
  const command = {
    operation: "invites.create",
    maxUses: 2,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    reason: "audit",
  } as const;
  const invite = await run(admin.id, command, request);
  await run(admin.id, command, request);
  await expect(
    run(admin.id, { ...command, maxUses: 3 }, request),
  ).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
  await expect(run(user.id, { operation: "users.list" })).rejects.toMatchObject(
    { code: "REGISTRATION_REQUIRED" },
  );
  const rows = (
    await db.postgres.query("SELECT * FROM operation_audit ORDER BY id")
  ).rows;
  expect(rows.map((r) => r.outcome)).toEqual([
    "accepted",
    "accepted",
    "replayed",
    "conflict",
    "denied",
  ]);
  expect(JSON.stringify(rows)).not.toContain(invite.token as string);
  const listed = await run(admin.id, { operation: "audit.list" });
  expect((listed.items as unknown[]).length).toBe(5);
  expect(
    (
      await db.postgres.query(
        "SELECT details FROM operation_audit ORDER BY id DESC LIMIT 1",
      )
    ).rows[0].details,
  ).toEqual({});
});

test("APIは本人セッションとCSRFを要求し、役割の自己申告・招待制の直接迂回を拒否する", async () => {
  expect((await app.inject("/api/account")).statusCode).toBe(401);
  const admin = await person(),
    user = await person();
  const post = (who: typeof admin, command: unknown) =>
    app.inject({
      method: "POST",
      url: "/api/operations",
      headers: { cookie: who.cookie, "x-gestaloka-request": "1" },
      payload: { requestId: randomUUID(), command },
    });
  expect(
    (await post(admin, { operation: "account.register", role: "admin" }))
      .statusCode,
  ).toBe(400);
  expect(
    (await post(admin, { operation: "account.register" })).statusCode,
  ).toBe(200);
  expect((await post(user, { operation: "account.register" })).statusCode).toBe(
    403,
  );
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/operations",
        headers: { cookie: admin.cookie },
        payload: {
          requestId: randomUUID(),
          command: { operation: "settings.read" },
        },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        url: "/api/account",
        headers: { cookie: admin.cookie },
      })
    ).json().member,
  ).toMatchObject({ id: admin.id, role: "admin" });
});

test("復旧CLIは未登録の本人IDも管理者として登録でき、自動初代付与を繰り返さない", async () => {
  const actor = await person();
  const result = await ops.recover(
    actor.id,
    randomUUID(),
    "最初の管理者の保守登録",
  );
  expect(result.member).toMatchObject({
    id: actor.id,
    role: "admin",
    banned: false,
  });
  expect((await ops.state(actor.id)).bootstrapAvailable).toBe(false);
  await expect(
    run((await person()).id, { operation: "account.register" }),
  ).rejects.toMatchObject({ code: "INVITATION_REQUIRED" });
});

test("ユーザー一覧をページを跨いで全件取得し、監査へ一覧本文を重複保存しない", async () => {
  const admin = await founder();
  await db.postgres.query(
    "WITH added AS(INSERT INTO app_identity(id,ory_id) SELECT gen_random_uuid(),gen_random_uuid() FROM generate_series(1,60) RETURNING id) INSERT INTO app_user(id,role) SELECT id,'user' FROM added",
  );
  const first = await run(admin.id, { operation: "users.list" });
  const next = await run(admin.id, {
    operation: "users.list",
    before: first.next as string,
  });
  const rows = [
    ...(first.items as { id: string }[]),
    ...(next.items as { id: string }[]),
  ];
  expect(rows).toHaveLength(61);
  expect(new Set(rows.map((r) => r.id)).size).toBe(61);
  expect(next.next).toBeNull();
  const audit = (
    await db.postgres.query(
      "SELECT details FROM operation_audit WHERE operation='users.list'",
    )
  ).rows;
  expect(audit.every((r) => Object.keys(r.details).length === 0)).toBe(true);
});
