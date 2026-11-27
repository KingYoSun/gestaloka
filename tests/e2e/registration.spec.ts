import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { connectDatabases } from "@gestaloka/server";
import { OryIdentity } from "@gestaloka/server/identity";
import { Operations } from "@gestaloka/server/operations";
import { legalVersion, terms, privacy } from "@gestaloka/server/legal";
import { createApp } from "../../apps/api/src/app.js";

test("本人の登録操作で初代管理者となって元の画面へ戻り、再訪でも登録と監査を増やさない", async ({
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
    for (const [path, heading] of [
      ["terms", "利用規約"],
      ["privacy", "プライバシーポリシー"],
    ]) {
      await page.goto(origin + "/auth/" + path);
      await expect(
        page.getByRole("heading", { level: 1, name: heading! }),
      ).toBeVisible();
    }
    await page.context().addCookies([
      {
        name: "ory_test",
        value: "registration-test",
        domain: "127.0.0.1",
        path: "/",
      },
    ]);
    await page.route("http://ory.invalid/**", (route) =>
      route.fulfill({ body: "" }),
    );
    const back = "http://app.invalid/worlds?tab=mine";
    const direct = await page.request.post(origin + "/api/operations", {
      headers: { "x-gestaloka-request": "1" },
      data: {
        requestId: randomUUID(),
        command: { operation: "account.register" },
      },
    });
    expect(direct.status()).toBe(403);
    expect((await direct.json()).code).toBe("LEGAL_CONSENT_REQUIRED");
    await page.goto(
      `${origin}/auth/register?return_to=${encodeURIComponent(back)}`,
    );
    const consentPage = page.url();
    expect(new URL(consentPage).pathname).toBe("/auth/legal");
    for (const title of ["利用規約", "プライバシーポリシー"]) {
      const region = page.getByRole("region", { name: title, exact: true });
      await expect(region).toBeVisible();
      expect(
        await region.evaluate((e) => e.scrollHeight > e.clientHeight),
      ).toBe(true);
    }
    const checkbox = page.getByRole("checkbox", { name: /利用規約/ });
    await expect(checkbox).not.toBeChecked();
    await page.getByRole("button", { name: "同意して進む" }).click();
    await expect(checkbox).toBeFocused();
    let csrf = await page.locator('[name="csrf"]').inputValue();
    expect(
      (
        await page.request.post(consentPage, {
          form: { csrf, version: legalVersion },
        })
      ).status(),
    ).toBe(400);
    await page.reload();
    csrf = await page.locator('[name="csrf"]').inputValue();
    expect(
      (
        await page.request.post(consentPage, {
          form: { csrf, version: "older-edition", agree: "yes" },
        })
      ).status(),
    ).toBe(409);
    expect(
      (await db.postgres.query("SELECT * FROM app_legal_consent")).rowCount,
    ).toBe(0);
    await page.reload();
    await checkbox.check();
    await page.getByRole("button", { name: "同意して進む" }).click();
    await expect(
      page.getByText(
        "最初に利用登録した1人が管理者になります。その後は招待制になります。",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "利用登録する" }).click();
    await page.waitForURL(
      `http://ory.invalid/self-service/login/browser?return_to=${encodeURIComponent(back)}`,
    );
    await page.goto(origin + "/auth/register");
    await page.waitForURL("http://ory.invalid/self-service/login/browser");
    expect(
      (await db.postgres.query("SELECT role FROM app_user")).rows[0].role,
    ).toBe("admin");
    expect(
      (
        await db.postgres.query(
          "SELECT version,accepted_at FROM app_legal_consent",
        )
      ).rows,
    ).toEqual([{ version: legalVersion, accepted_at: expect.any(Date) }]);
    expect(
      (
        await db.postgres.query(
          "SELECT terms,privacy FROM app_legal_edition WHERE version=$1",
          [legalVersion],
        )
      ).rows,
    ).toEqual([{ terms, privacy }]);
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
