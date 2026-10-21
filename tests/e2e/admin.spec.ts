import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { WorldAccess } from "@gestaloka/server/access";
import { fixtureRuntime } from "../support/provider.js";
import { fixtureAuth } from "../support/auth.js";
import { isolatedDatabases } from "../support/isolated-db.js";
import { createApp } from "../../apps/api/src/app.js";
let isolated: ReturnType<typeof isolatedDatabases>,
  auth: Awaited<ReturnType<typeof fixtureAuth>>,
  runtime: Awaited<ReturnType<typeof fixtureRuntime>>["runtime"],
  app: Awaited<ReturnType<typeof createApp>>,
  admin: string,
  other: string,
  scope: string;
test.beforeEach(async ({ page, context }) => {
  isolated = isolatedDatabases();
  await isolated.setup();
  scope = randomUUID();
  ({ runtime } = await fixtureRuntime(scope, undefined, isolated.databases));
  await runtime.work();
  auth = await fixtureAuth(
    isolated.databases.postgres,
    async (token) => {
      const id = token.slice("test_ory=".length);
      const row = (
        await isolated.databases.postgres.query(
          "SELECT ory_id FROM app_identity WHERE id=$1",
          [id],
        )
      ).rows[0];
      return row ? { ory: row.ory_id, session: id } : undefined;
    },
    {
      hydraAdminUrl: "http://fixture-hydra.invalid",
      transport: async () => Response.json({}),
    },
    async () => Response.json({ data: [{ id: "fixture-model" }] }),
  );
  admin = (await auth.person()).id;
  other = (await auth.person("user")).id;
  await isolated.databases.postgres.query(
    "UPDATE operation_state SET bootstrapped=true",
  );
  const access = new WorldAccess(runtime);
  await access.setup();
  app = await createApp(access, auth.identity, undefined, auth.operations);
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  await context.addCookies([
    {
      name: "test_ory",
      value: admin,
      url: "http://127.0.0.1",
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  await page.route(/\/(api|auth)\//, async (route) => {
    const u = new URL(route.request().url());
    await route.fulfill({
      response: await route.fetch({
        url: origin + u.pathname + u.search,
        headers: { ...route.request().headers(), origin },
      }),
    });
  });
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.close();
  await app?.close();
  const db = isolated.databases;
  for (const r of (await db.postgres.query("SELECT world_id FROM world_build"))
    .rows)
    if (r.world_id)
      await db.graph.executeQuery(
        "MATCH(n) WHERE n.worldId=$id DETACH DELETE n",
        { id: r.world_id },
      );
  for (const suffix of ["", "-play", "-scenes", "-joins"])
    await db.queue.deleteQueue(`e2e-${scope}${suffix}`);
  await db.queue.stop();
  await isolated.close();
});
test("招待・追加管理者・BANを画面から操作し、権限変更で管理情報を破棄する", async ({
  page,
  context,
}) => {
  await page.goto("http://127.0.0.1:4174/operations/users");
  await page.getByLabel("操作を選択").selectOption("users.role");
  await page.getByLabel("ユーザーID", { exact: true }).fill(other);
  await page.getByLabel("役割", { exact: true }).selectOption("admin");
  await page
    .getByLabel("操作の理由", { exact: true })
    .fill("追加管理者を任命する");
  await page
    .getByRole("button", { name: "内容を確認する", exact: true })
    .click();
  expect((await auth.operations.state(other)).member?.role).toBe("user");
  await page
    .getByRole("button", { name: "この内容で実行する", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "別の操作を始める" }),
  ).toBeVisible();
  expect((await auth.operations.state(other)).member?.role).toBe("admin");
  await page.reload();
  await expect(
    page.getByText("追加管理者を任命する", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "招待", exact: true }).click();
  await page.getByLabel("操作を選択").selectOption("invites.create");
  await page.getByLabel("有効期限", { exact: true }).fill("2030-01-01T12:00");
  await page.getByLabel("利用可能回数", { exact: true }).fill("2");
  await page
    .getByLabel("操作の理由", { exact: true })
    .fill("参加者へ招待を発行する");
  await page
    .getByRole("button", { name: "内容を確認する", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この内容で実行する", exact: true })
    .click();
  await expect(page.getByText("招待トークン", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel("操作を選択").selectOption("invites.create");
  await expect(page.getByText("招待トークン", { exact: true })).toBeVisible();
  const invitation = await page
    .getByText("招待トークン", { exact: true })
    .locator("..")
    .locator("dd")
    .innerText();
  expect(
    (
      await isolated.databases.postgres.query(
        "SELECT count(*)::int AS n FROM app_invite",
      )
    ).rows[0].n,
  ).toBe(1);
  await page.screenshot({
    path: "artifacts/screenshots/admin-invites.png",
    fullPage: true,
  });
  await auth.operations.execute(other, randomUUID(), {
    operation: "users.role",
    userId: admin,
    role: "user",
    reason: "役割変更の反映",
  });
  await expect(
    page.getByText("管理者の権限が必要です。", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("招待トークン", { exact: true })).toHaveCount(0);
  const denied = await page.evaluate(
    async () =>
      (
        await fetch("/api/operations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Gestaloka-Request": "1",
          },
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            command: { operation: "users.list" },
          }),
        })
      ).status,
  );
  expect(denied).toBe(403);
  await auth.operations.execute(other, randomUUID(), {
    operation: "users.ban",
    userId: admin,
    banned: true,
    reason: "利用停止の表示",
  });
  await expect(
    page.getByText(
      "利用が停止されています（BAN）。解除後に保存状態から再開できます。",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 10000 });
  await context.clearCookies();
  const invited = randomUUID();
  await isolated.databases.postgres.query(
    "INSERT INTO app_identity(id,ory_id) VALUES($1,$2)",
    [invited, randomUUID()],
  );
  await context.addCookies([
    {
      name: "test_ory",
      value: invited,
      url: "http://127.0.0.1",
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  await page.goto("http://127.0.0.1:4174/auth/register");
  await page
    .getByLabel("招待トークン", { exact: true })
    .fill("invalid-invitation");
  await page.getByRole("button", { name: "利用登録する", exact: true }).click();
  await expect(
    page.getByText("有効な招待トークンが必要です", { exact: true }),
  ).toBeVisible();
  expect((await auth.operations.state(invited)).member).toBeNull();
  await page.getByLabel("招待トークン", { exact: true }).fill(invitation);
  await page.getByRole("button", { name: "利用登録する", exact: true }).click();
  await expect(
    page.getByText("利用登録済みです。", { exact: true }),
  ).toBeVisible();
  await page.reload();
  expect((await auth.operations.state(invited)).member?.role).toBe("user");
  expect(
    (
      await isolated.databases.postgres.query(
        "SELECT uses::int AS n FROM app_invite",
      )
    ).rows[0].n,
  ).toBe(1);
  await page.goto("http://127.0.0.1:4174/operations/users");
  await expect(
    page.getByText("管理者の権限が必要です。", { exact: true }),
  ).toBeVisible();
});

test("設定・計算額・世界差分を共通APIへ接続し、狭い画面とテーマを維持する", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4174/operations/limits");
  await page
    .getByRole("button", { name: "この設定を入力に使う", exact: true })
    .click();
  await page.getByLabel("call回数", { exact: true }).fill("32");
  await page
    .getByLabel("操作の理由", { exact: true })
    .fill("応答生成の上限を設定する");
  await page
    .getByRole("button", { name: "内容を確認する", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この内容で実行する", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "別の操作を始める" }),
  ).toBeVisible();
  expect(
    (
      await auth.operations.execute(admin, randomUUID(), {
        operation: "responseLimits.read",
      })
    ).calls,
  ).toBe(32);
  await page
    .getByRole("link", { name: "メンテナンス・監視", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この設定を入力に使う", exact: true })
    .click();
  await page.getByLabel("メンテナンス・運用停止", { exact: true }).check();
  await page.getByLabel("エラー率（%）を指定", { exact: true }).check();
  await page.getByLabel("エラー率（%）", { exact: true }).fill("10");
  await page.getByLabel("操作の理由", { exact: true }).fill("監視と停止の設定");
  await page
    .getByRole("button", { name: "内容を確認する", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この内容で実行する", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "別の操作を始める" }),
  ).toBeVisible();
  const control = await auth.operations.execute(admin, randomUUID(), {
    operation: "runtime.read",
  });
  expect(control.configuration).toMatchObject({
    paused: true,
    thresholds: { errorPercent: 10 },
  });
  await auth.operations.execute(admin, randomUUID(), {
    operation: "runtime.put",
    configuration: {
      paused: false,
      concurrency: null,
      sampleIntervalSeconds: 60,
      retentionDays: 30,
      thresholds: {},
    },
    expectedVersion: control.version as number,
    reason: "停止を解除",
  });
  await page
    .getByRole("link", { name: "モデル・単価・APIキー", exact: true })
    .click();
  await page.getByLabel("操作を選択").selectOption("credentials.put");
  await page.getByLabel("APIサービス", { exact: true }).selectOption("openai");
  await page
    .getByLabel("新しいAPIキー", { exact: true })
    .fill("fixture-secret-write-only");
  await page.getByLabel("操作の理由", { exact: true }).fill("試験用のAPIキー");
  await page
    .getByRole("button", { name: "内容を確認する", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この内容で実行する", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "別の操作を始める" }),
  ).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "fixture-secret-write-only",
  );
  const m = {
    provider: "openai" as const,
    model: "fixture-model",
    baseUrl: "http://fixture-model.invalid/v1",
    api: "responses" as const,
    effort: "low" as const,
    initialEffort: "high" as const,
    contextTokens: 10000,
    maxOutputTokens: 1000,
    inputUsdPerMillion: 1,
    cachedInputUsdPerMillion: 0.1,
    outputUsdPerMillion: 2,
    pricingDate: "2026-10-21",
  };
  await auth.operations.execute(admin, randomUUID(), {
    operation: "models.put",
    configuration: { default: m, resolution: m, judgment: "combined" },
    expectedVersion: 0,
    reason: "既知の設定を準備",
  });
  await page.getByLabel("操作を選択").selectOption("models.read");
  await page
    .getByRole("button", { name: "この設定を入力に使う", exact: true })
    .click();
  await page
    .getByRole("group", { name: "観測・意図・シーンの担当", exact: true })
    .getByLabel("通常の推論量", { exact: true })
    .selectOption("medium");
  await page
    .getByLabel("操作の理由", { exact: true })
    .fill("担当の推論量を変更");
  await page
    .getByRole("button", { name: "内容を確認する", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この内容で実行する", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "別の操作を始める" }),
  ).toBeVisible();
  expect(
    (await auth.operations.models.latest())?.configuration.default.effort,
  ).toBe("medium");
  const created = await page.evaluate(async () => {
    const r = await fetch("/api/operations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Gestaloka-Request": "1",
      },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        command: {
          operation: "worlds.create",
          prompt: "管理画面で確認する村",
          budgetUsd: 20,
          reason: "UIの世界編集確認",
        },
      }),
    });
    return (await r.json()) as { result: { id: string } };
  });
  const worldId = created.result.id;
  await expect
    .poll(
      async () =>
        (
          await isolated.databases.postgres.query(
            "SELECT state FROM world_construction WHERE id=$1",
            [worldId],
          )
        ).rows[0]?.state,
    )
    .toBe("ready");
  await page.getByRole("link", { name: "費用の計算額", exact: true }).click();
  await page.getByLabel("表示内容", { exact: true }).selectOption("timeline");
  await page.getByRole("button", { name: "取得する", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "時系列の計算額" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "世界・参加設定", exact: true }).click();
  await page.getByLabel("操作を選択").selectOption("worlds.edit");
  await page.getByLabel("世界ID", { exact: true }).fill(worldId);
  await page.getByLabel("操作の理由", { exact: true }).fill("灯台を配置する");
  const node = randomUUID();
  await page.getByLabel("LLMが作成したJSON差分", { exact: true }).fill(
    JSON.stringify({
      at: 0,
      dependencies: [],
      changes: {
        nodes: [{ id: node, kind: "existence", text: "管理者が配置した灯台" }],
        edges: [],
        revisions: [],
        endEdges: [],
      },
    }),
  );
  await page
    .getByRole("button", { name: "内容を確認する", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この内容で実行する", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "別の操作を始める" }),
  ).toBeVisible();
  const graph = isolated.databases.graph;
  expect(
    (
      await graph.executeQuery("MATCH(n:WorldNode {id:$id}) RETURN n", {
        id: node,
      })
    ).records,
  ).toHaveLength(1);
  await page.reload();
  await page.getByLabel("操作を選択").selectOption("worlds.edit");
  await expect(
    page.getByRole("button", { name: "別の操作を始める" }),
  ).toBeVisible();
  expect(
    (
      await graph.executeQuery("MATCH(n:WorldNode {id:$id}) RETURN n", {
        id: node,
      })
    ).records,
  ).toHaveLength(1);
  await page.setViewportSize({ width: 375, height: 812 });
  await page
    .getByRole("button", { name: "ダークモードに切り替える", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/screenshots/admin-mobile-dark.png",
    fullPage: true,
  });
});

test("MCP登録・認可失効とバックアップ画面の受付・進捗を共通処理へ接続する", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4174/operations/mcp");
  await page.getByLabel("操作を選択").selectOption("mcp.clients.put");
  const clientId = await page
    .getByLabel("MCPクライアントID", { exact: true })
    .inputValue();
  await page.getByLabel("名称", { exact: true }).fill("手元のLLM");
  await page.getByLabel("有効にする", { exact: true }).check();
  await page
    .getByLabel("Callback URL（1行に1件）", { exact: true })
    .fill("http://127.0.0.1:18999/callback");
  await page.getByLabel("worlds.graph", { exact: true }).check();
  await page
    .getByLabel("操作の理由", { exact: true })
    .fill("クライアントを登録");
  await page
    .getByRole("button", { name: "内容を確認する", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この内容で実行する", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "別の操作を始める" }),
  ).toBeVisible();
  const clients = (
    await auth.operations.mcp.clients(isolated.databases.postgres)
  ).items;
  expect(clients).toMatchObject([
    {
      id: clientId,
      configuration: {
        enabled: true,
        scopes: ["worlds.graph"],
        worldIds: null,
      },
    },
  ]);
  const grant = randomUUID();
  await isolated.databases.postgres.query(
    "INSERT INTO mcp_grant(id,client_id,user_id,scopes,world_ids,consent_hash) VALUES($1,$2,$3,$4,NULL,$5)",
    [grant, clientId, admin, ["mcp.connect", "worlds.graph"], randomUUID()],
  );
  await page.getByLabel("操作を選択").selectOption("mcp.grants.list");
  await page
    .getByRole("button", { name: "この記録を入力に使う", exact: true })
    .click();
  await expect(page.getByLabel("認可ID", { exact: true })).toHaveValue(grant);
  await page.getByLabel("操作の理由", { exact: true }).fill("認可を失効する");
  await page
    .getByRole("button", { name: "内容を確認する", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この内容で実行する", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "別の操作を始める" }),
  ).toBeVisible();
  expect(
    (
      await isolated.databases.postgres.query(
        "SELECT revoked FROM mcp_grant WHERE id=$1",
        [grant],
      )
    ).rows[0].revoked,
  ).toBe(true);

  // The controller protocol is a fixture here; real encrypted S3 backup/restore runs in test:recovery.
  const prepared: string[] = [],
    jobs = new Map<string, Record<string, unknown>>();
  let state = "queued";
  auth.operations.backups.call = async (action, body) => {
    const b = body as { id: string; input?: { operation: string } };
    if (action === "read")
      return {
        version: 0,
        configured: false,
        configuration: { enabled: false, intervalHours: 24, retentionDays: 30 },
        busy: false,
      };
    if (action === "prepare") {
      prepared.push(b.id);
      jobs.set(b.id, {
        id: b.id,
        operation: b.input?.operation,
        state,
        phase: "受付済み",
      });
      return { id: b.id };
    }
    if (action === "activate") return {};
    if (action === "jobs")
      return {
        items: [...jobs.values()].map((v) => ({ ...v, state })),
        next: null,
      };
    if (action === "job") return { job: { ...jobs.get(b.id), state } };
    return { items: [], next: null };
  };
  await page
    .getByRole("link", { name: "バックアップ・復元", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この設定を入力に使う", exact: true })
    .click();
  await expect(
    page.getByLabel("取得間隔（時間）", { exact: true }),
  ).toHaveValue("24");
  await page
    .getByLabel("バックアップ先（s3:https://…）", { exact: true })
    .fill("s3:https://storage.invalid/test");
  await page
    .getByLabel("S3アクセスキー", { exact: true })
    .fill("fixture-access");
  await page.getByLabel("S3秘密キー", { exact: true }).fill("fixture-secret");
  await page
    .getByLabel("暗号化パスワード（16文字以上）", { exact: true })
    .fill("fixture-password-long");
  await page.getByLabel("S3リージョン", { exact: true }).fill("test-region");
  await page
    .getByLabel("操作の理由", { exact: true })
    .fill("バックアップ先を設定");
  await page
    .getByRole("button", { name: "内容を確認する", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この内容で実行する", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "別の操作を始める" }),
  ).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(
    /fixture-access|fixture-secret|fixture-password/,
  );
  await page.reload();
  await page.getByLabel("操作を選択").selectOption("backups.configure");
  await expect(
    page.getByRole("button", { name: "別の操作を始める" }),
  ).toBeVisible();
  expect(prepared).toHaveLength(1);
  await page.getByLabel("操作を選択").selectOption("backups.jobs");
  await page
    .getByRole("button", { name: "この記録を入力に使う", exact: true })
    .click();
  await expect(page.getByLabel("ID", { exact: true })).toHaveValue(
    prepared[0]!,
  );
  await expect(page.getByText("待機中", { exact: true })).toBeVisible();
  state = "running";
  await page.getByRole("button", { name: "更新する", exact: true }).click();
  await expect(page.getByText("処理中", { exact: true })).toBeVisible();
  state = "failed";
  await page.getByRole("button", { name: "更新する", exact: true }).click();
  await expect(page.getByText("失敗", { exact: true })).toBeVisible();
  state = "complete";
  await page.getByRole("button", { name: "更新する", exact: true }).click();
  await expect(page.getByText("完了", { exact: true })).toBeVisible();
});
