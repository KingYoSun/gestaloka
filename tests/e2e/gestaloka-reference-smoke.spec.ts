import { expect, test } from "@playwright/test";

test("login, select GESTALOKA reference world, and clear the nexus smoke flow", async ({ page }) => {
  test.setTimeout(360_000);
  const worldId = "gestaloka_reference";
  const slowTimeout = 30_000;
  const turnTimeout = 180_000;

  await page.goto("/");
  await expect(page.getByTestId("error-banner").filter({ hasText: "A 'Keycloak' instance can only be initialized once." })).toHaveCount(0);
  await page.getByTestId("sign-in").click();

  await page.locator("#username").fill("demo");
  await page.locator("#password").fill("demo-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByTestId("auth-status")).toContainText("authenticated");
  await expect(page.getByTestId("error-banner").filter({ hasText: "A 'Keycloak' instance can only be initialized once." })).toHaveCount(0);
  await expect(page.getByTestId("sp-balance")).toContainText(/SP balance:\s*-?\d+/, { timeout: slowTimeout });
  await expect(page.getByTestId("sp-budget-note")).toContainText("execution budget");

  await page.getByTestId("world-select").selectOption(worldId);
  await page.getByTestId("profile-display-name").fill("Demo Player");
  await page.getByTestId("profile-play-language").selectOption("en");
  await page.getByTestId("create-player-profile").click();
  await expect(page.getByTestId("player-profile-select")).toContainText("Demo Player", { timeout: slowTimeout });
  await page.getByTestId("start-session").click();

  await expect(page.getByTestId("socket-status")).toContainText("open", { timeout: 20_000 });
  await expect(page.getByTestId("session-pack")).toContainText("GESTALOKA Reference", { timeout: 20_000 });
  await expect(page.getByTestId("session-pack")).toContainText("Nexus Foundation", { timeout: 20_000 });
  await expect(page.getByTestId("ops-stream")).toContainText("session.connected", { timeout: 20_000 });
  await expect(page.getByTestId("ops-stream")).toContainText("GESTALOKA Reference", { timeout: 20_000 });
  await expect(page.getByTestId("ops-stream")).not.toContainText("missing world context");
  await expect(page.getByTestId("ops-stream")).not.toContainText("global");
  await expect(page.getByTestId("ops-stream")).not.toContainText("{");
  await expect(page.getByTestId("npc-routine-stream")).not.toContainText("{");
  await expect(page.getByTestId("current-place-summary")).toContainText(/Nexus Gate/i, { timeout: 20_000 });
  await expect(page.getByTestId("current-chapter-summary")).toContainText(/opening|Nexus/i, { timeout: 20_000 });
  await expect(page.getByTestId("active-quest")).toContainText("First Stabilizer Request", { timeout: 20_000 });
  await expect(page.getByTestId("quest-progress")).toContainText("0/2", { timeout: 20_000 });
  await expect(page.getByTestId("local-figures-stream")).toContainText(/Gate Steward Rikka/i, { timeout: 20_000 });
  await expect(page.getByTestId("nearby-routes-stream")).toContainText(/Lift Tower Concourse/i, { timeout: 20_000 });
  await expect(page.getByTestId("faction-standing")).toContainText(/Nexus Custodians/i, { timeout: 20_000 });
  await expect(page.getByTestId("turn-progress-status")).toContainText("選択待ち");
  await expect(page.getByTestId("choice-progress")).toContainText("Help the person in need and create the next opening");
  await expect(page.getByTestId("choice-explore")).toContainText("Go to Lift Tower Concourse and check the old records");

  for (let step = 0; step < 2; step += 1) {
    await page.getByTestId("choice-progress").click();
    await expect(page.getByTestId("turn-progress-status")).toContainText("進行中", { timeout: 5_000 });
    await expect(page.getByTestId("choice-progress")).toBeEnabled({ timeout: turnTimeout });
  }

  await expect(page.getByTestId("quest-progress")).toContainText("2/2", { timeout: slowTimeout });
  await expect(page.getByTestId("inventory-stream")).toContainText(/Nexus Writ/i, { timeout: slowTimeout });
  await expect(page.getByTestId("choice-progress")).toBeVisible({ timeout: slowTimeout });

  await page.getByTestId("choice-progress").click();
  await expect(page.getByTestId("turn-progress-status")).toContainText("進行中", { timeout: 5_000 });
  await expect(page.getByTestId("choice-progress")).toBeEnabled({ timeout: turnTimeout });
  await expect(page.getByTestId("active-quest")).toContainText("Breach Restoration", { timeout: slowTimeout });
  await expect(page.getByTestId("quest-stage")).toContainText("breach_restoration", { timeout: slowTimeout });
  await expect(page.getByTestId("inventory-stream")).toContainText("used", { timeout: slowTimeout });
  await expect(page.getByTestId("nearby-routes-stream")).toContainText(/Oblivion Breach/i, { timeout: slowTimeout });

  await page.getByTestId("choice-progress").click();
  await expect(page.getByTestId("turn-progress-status")).toContainText("進行中", { timeout: 5_000 });
  await expect(page.getByTestId("choice-progress")).toBeEnabled({ timeout: turnTimeout });
  await expect(page.getByTestId("current-place-summary")).toContainText(/Oblivion Breach/i, { timeout: slowTimeout });
  await expect(page.getByTestId("recent-travel-history")).toContainText(/Oblivion Breach|breach|restoration/i, {
    timeout: slowTimeout,
  });
  await expect(page.getByTestId("current-chapter-summary")).toContainText(/breach|restoration/i, { timeout: slowTimeout });
});

test("mobile player shell does not overflow at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  await expect(page.getByTestId("sign-in")).toBeVisible();
  await expect(page.getByRole("button", { name: "アカウントを作成して始める" })).toBeVisible();
  await expect(page.getByTestId("error-banner").filter({ hasText: "A 'Keycloak' instance can only be initialized once." })).toHaveCount(0);

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasHorizontalOverflow).toBe(false);
});

test("player language switcher changes fixed UI labels and persists", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("sign-in")).toContainText("ログインして続ける");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");

  await page.getByRole("button", { name: /EN/ }).click();
  await expect(page.getByTestId("sign-in")).toContainText("Sign in to continue");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.reload();
  await expect(page.getByTestId("sign-in")).toContainText("Sign in to continue");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.getByRole("button", { name: /JA/ }).click();
  await expect(page.getByTestId("sign-in")).toContainText("ログインして続ける");
});
