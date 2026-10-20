import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { connectDatabases } from "@gestaloka/server";
import { OryIdentity } from "@gestaloka/server/identity";
import { Operations } from "@gestaloka/server/operations";
import { createApp } from "../../apps/api/src/app.js";

test("本人の登録操作で初代管理者となり、再読込でも登録と監査を増やさない", async ({
  page,
}) => {
  const root = connectDatabases(),
    schema = "registration_test_" + randomUUID().replaceAll("-", "");
  await root.postgres.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const db = connectDatabases({ ...process.env, DATABASE_URL: url.toString() });
  const id = randomUUID();
  const identity = new OryIdentity(
    db.postgres,
    "http://ory.invalid",
    async () =>
      Response.json({
        id: randomUUID(),
        active: true,
        expires_at: new Date(Date.now() + 60000).toISOString(),
        identity: { id, state: "active" },
      }),
  );
  await identity.setup();
  const operations = new Operations(db.postgres, "1".repeat(64));
  await operations.setup();
  const app = await createApp(undefined, identity, undefined, operations);
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    await page.context().addCookies([
      {
        name: "ory_test",
        value: "registration-test",
        domain: "127.0.0.1",
        path: "/",
      },
    ]);
    await page.goto(origin + "/auth/register");
    await expect(
      page.getByText(
        "最初に利用登録した1人が管理者になります。その後は招待制になります。",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "利用登録する" }).click();
    await expect(
      page.getByText("管理者として利用登録済みです。"),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("管理者として利用登録済みです。"),
    ).toBeVisible();
    expect(
      Number(
        (await db.postgres.query("SELECT count(*) FROM app_user")).rows[0]
          .count,
      ),
    ).toBe(1);
    expect(
      Number(
        (
          await db.postgres.query(
            "SELECT count(*) FROM operation_audit WHERE operation='account.register' AND outcome='accepted'",
          )
        ).rows[0].count,
      ),
    ).toBe(1);
  } finally {
    await app.close();
    await db.close();
    await root.postgres.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.close();
  }
});
