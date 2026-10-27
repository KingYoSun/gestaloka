import { test, expect } from "@playwright/test";
import {
  InspectionStore,
  entries,
} from "../../packages/server/src/inspection/store.js";
import { measure } from "../../packages/server/src/inspection/measure.js";
import { inspectionFixture } from "../fixtures/inspection.js";
import { isolatedDatabases } from "../support/isolated-db.js";
import { fixtureAuth } from "../support/auth.js";
import { createApp } from "../../apps/api/src/app.js";

test("定期集計の画面から固定した提示文と根拠を読む", async ({
  page,
  context,
}, testInfo) => {
  const isolated = isolatedDatabases();
  await isolated.setup();
  const pool = isolated.databases.postgres,
    auth = await fixtureAuth(pool),
    admin = await auth.person();
  const m = inspectionFixture(),
    measurement = measure(m);
  await InspectionStore.setup(pool);
  await pool.query(
    "INSERT INTO inspection_manifest(id,world_id,actor_id,user_id,data,measurement) VALUES($1,$2,$3,$4,$5,$6)",
    [
      m.id,
      m.selection.worldId,
      m.selection.actorId,
      m.selection.userId,
      m,
      measurement,
    ],
  );
  await pool.query(
    "INSERT INTO inspection_evidence(manifest_id,position,value) SELECT $1,(ordinality-1)::int,value FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY",
    [m.id, JSON.stringify(entries(m))],
  );
  const app = await createApp(
      undefined,
      auth.identity,
      undefined,
      auth.operations,
    ),
    origin = await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    await context.addCookies([
      {
        name: "test_ory",
        value: admin.id,
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
    await page.goto("http://127.0.0.1:4174/operations/inspection");
    await page.getByLabel("世界ID", { exact: true }).fill(m.selection.worldId);
    await page.getByRole("button", { name: "取得する", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "物語移動量の推移と分布" }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: /移動量の時系列/ }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("inspection-history.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "提示と根拠", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "固定した検品資料" }),
    ).toBeVisible();
    await expect(page.getByText("扉は開いた。", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("inspection-evidence.png"),
      fullPage: true,
    });
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await app.close();
    await isolated.close();
  }
});
