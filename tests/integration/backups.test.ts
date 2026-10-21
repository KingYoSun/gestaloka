import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isolatedDatabases } from "../support/isolated-db.js";
import { fixtureAuth } from "../support/auth.js";
import { AccessError } from "@gestaloka/server/access";
let isolated: ReturnType<typeof isolatedDatabases>,
  auth: Awaited<ReturnType<typeof fixtureAuth>>;
beforeEach(async () => {
  isolated = isolatedDatabases();
  await isolated.setup();
  auth = await fixtureAuth(isolated.databases.postgres);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await isolated.close();
});
test("バックアップ操作は共通の管理者権限・監査・再送判定を通り、確定後だけ開始する", async () => {
  const admin = (await auth.person()).id,
    user = (await auth.person("user")).id,
    id = randomUUID(),
    input = {
      operation: "backups.restore" as const,
      snapshot: "a".repeat(64),
      reason: "復旧試験",
    };
  const call = vi
    .spyOn(auth.operations.backups, "call")
    .mockImplementation(async (action, body) => {
      if (action === "activate") {
        const saved = (
          await isolated.databases.postgres.query(
            "SELECT result FROM operation_request WHERE id=$1",
            [id],
          )
        ).rows[0];
        expect(saved.result).toEqual({ id });
      }
      return action === "prepare" ? { id: (body as { id: string }).id } : {};
    });
  await expect(
    auth.operations.execute(user, randomUUID(), input),
  ).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  expect(call).not.toHaveBeenCalled();
  await auth.operations.execute(admin, id, input);
  await auth.operations.execute(admin, id, input);
  expect(
    call.mock.calls.filter(([action]) => action === "prepare"),
  ).toHaveLength(1);
  await expect(
    auth.operations.execute(admin, id, { ...input, snapshot: "b".repeat(64) }),
  ).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
  const audit = (
    await isolated.databases.postgres.query(
      "SELECT outcome,details FROM operation_audit WHERE request_id=$1 ORDER BY id",
      [id],
    )
  ).rows;
  expect(audit.map((a) => a.outcome)).toEqual([
    "accepted",
    "replayed",
    "conflict",
  ]);
  expect(audit[0].details).toEqual({ id, reason: "復旧試験" });
});
test("保管先の秘密値は監査と応答へ含めない", async () => {
  const admin = (await auth.person()).id,
    id = randomUUID();
  vi.spyOn(auth.operations.backups, "call").mockResolvedValue({ id });
  await auth.operations.execute(admin, id, {
    operation: "backups.configure",
    expectedVersion: 0,
    reason: "設定",
    configuration: {
      enabled: false,
      intervalHours: 24,
      retentionDays: 30,
      repository: "s3:https://storage.invalid/bucket/prefix",
      accessKey: "private-access",
      secretKey: "private-secret",
      password: "private-password-long",
      region: "test",
    },
  });
  const rows = (
    await isolated.databases.postgres.query(
      "SELECT details FROM operation_audit WHERE request_id=$1",
      [id],
    )
  ).rows;
  expect(JSON.stringify(rows)).not.toContain("private-");
});
test("制御サービスとの通信断後も同じ要求IDを完了でき、別内容で要求を奪えない", async () => {
  const admin = (await auth.person()).id,
    id = randomUUID(),
    input = {
      operation: "backups.create" as const,
      reason: "通信断からの再開",
    };
  let available = false;
  vi.spyOn(auth.operations.backups, "call").mockImplementation(
    async (action) => {
      if (!available)
        throw new AccessError(503, "BACKUPS_UNAVAILABLE", "試験中の通信断");
      return action === "prepare" ? { id } : {};
    },
  );
  await expect(auth.operations.execute(admin, id, input)).rejects.toMatchObject(
    { status: 503 },
  );
  await expect(
    auth.operations.execute(admin, id, { ...input, reason: "異なる内容" }),
  ).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
  available = true;
  await expect(auth.operations.execute(admin, id, input)).resolves.toEqual({
    id,
  });
  expect(
    (
      await isolated.databases.postgres.query(
        "SELECT outcome FROM operation_audit WHERE request_id=$1 ORDER BY id",
        [id],
      )
    ).rows.map((r) => r.outcome),
  ).toEqual(["denied", "conflict", "accepted"]);
});
