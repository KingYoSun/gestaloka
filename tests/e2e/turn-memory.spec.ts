import { expect, test } from "@playwright/test";

test("login, travel across founders reach, unlock watch path, and keep SP separate from world progression", async ({ page }) => {
  test.setTimeout(420_000);
  const worldId = `e2e-travel-${Date.now()}`;
  const slowTimeout = 120_000;

  const readBalance = async () => {
    const text = await page.getByTestId("sp-balance").textContent();
    const match = text?.match(/SP balance:\s*(-?\d+)/);
    expect(match).not.toBeNull();
    return Number(match?.[1]);
  };

  const ensureBalanceAtLeast = async (minimum: number) => {
    const balance = await readBalance();
    if (balance >= minimum) {
      return;
    }
    await page.getByTestId("nav-admin").click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByTestId("adjust-delta").fill(String(Math.max(10, minimum) - balance));
    await page.getByTestId("submit-adjustment").click();
    await expect.poll(readBalance, { timeout: slowTimeout }).toBeGreaterThanOrEqual(minimum);
    await page.getByTestId("nav-game").click();
    await expect(page).toHaveURL(/\/$/);
  };

  const submitChoice = async (choiceId: "safe" | "progress" | "explore") => {
    await page.getByTestId(`choice-${choiceId}`).click();
  };

  await page.goto("/");
  await page.getByTestId("sign-in").click();

  await page.locator("#username").fill("demo");
  await page.locator("#password").fill("demo-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByTestId("auth-status")).toContainText("authenticated");
  await expect(page.getByTestId("sp-balance")).toContainText(/SP balance:\s*-?\d+/, { timeout: slowTimeout });
  await expect(page.getByTestId("sp-budget-note")).toContainText("execution budget");

  const currentBalance = await readBalance();
  if (currentBalance !== 10) {
    await page.getByTestId("nav-admin").click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByTestId("adjust-delta").fill(String(10 - currentBalance));
    await page.getByTestId("submit-adjustment").click();
    await expect(page.getByTestId("last-adjustment")).toContainText("balance 10");
    await page.getByTestId("nav-game").click();
    await expect(page).toHaveURL(/\/$/);
  }

  await page.getByTestId("world-id-input").fill(worldId);
  await page.getByTestId("start-session").click();
  await expect(page.getByTestId("socket-status")).toContainText("open", { timeout: 20_000 });
  await expect(page.getByTestId("current-place-summary")).toContainText(/Founders Square/i, { timeout: 20_000 });
  await expect(page.getByTestId("current-chapter-summary")).toContainText(/opening|Founders/i, { timeout: 20_000 });
  await expect(page.getByTestId("current-scene-summary")).toContainText(/Square|request/i, { timeout: 20_000 });
  await expect(page.getByTestId("active-quest")).toContainText("First Watch Request", { timeout: 20_000 });
  await expect(page.getByTestId("quest-progress")).toContainText("0/2", { timeout: 20_000 });
  await expect(page.getByTestId("plaza-figures-stream")).toContainText(/Courier Pell/i, { timeout: 20_000 });
  await expect(page.getByTestId("nearby-routes-stream")).toContainText(/Archive Steps/i, { timeout: 20_000 });
  await expect(page.getByTestId("choice-list")).toContainText(/Archive Steps/i, { timeout: 20_000 });

  await submitChoice("explore");
  await expect(page.getByTestId("current-place-summary")).toContainText(/Archive Steps/i, { timeout: slowTimeout });
  await expect(page.getByTestId("recent-travel-history")).toContainText(/Archive Steps|archive|stone steps/i, {
    timeout: slowTimeout,
  });
  await expect(page.getByTestId("plaza-figures-stream")).toContainText(/Archivist Nera/i, { timeout: slowTimeout });

  await submitChoice("progress");
  await expect(page.getByTestId("quest-progress")).toContainText("1/2", { timeout: slowTimeout });

  await submitChoice("progress");
  await expect(page.getByTestId("quest-progress")).toContainText("2/2", { timeout: slowTimeout });
  await expect(page.getByTestId("inventory-stream")).toContainText("Lantern Sigil", { timeout: slowTimeout });
  await expect(page.getByTestId("relationship-summary")).toContainText(/warm|trust/i, { timeout: slowTimeout });

  await ensureBalanceAtLeast(6);
  await submitChoice("safe");
  await expect(page.getByTestId("current-place-summary")).toContainText(/Founders Square/i, { timeout: slowTimeout });
  await expect(page.getByTestId("recent-travel-history")).toContainText(/Founders Square|square/i, { timeout: slowTimeout });

  await submitChoice("progress");
  await expect(page.getByTestId("active-quest")).toContainText("Watch Path Unsealed", { timeout: slowTimeout });
  await expect(page.getByTestId("quest-stage")).toContainText("watch_path_followup", { timeout: slowTimeout });
  await expect(page.getByTestId("inventory-stream")).toContainText("used", { timeout: slowTimeout });
  await expect(page.getByTestId("nearby-routes-stream")).toContainText(/Watch Path/i, { timeout: slowTimeout });

  await submitChoice("progress");
  await expect(page.getByTestId("current-place-summary")).toContainText(/Watch Path/i, { timeout: slowTimeout });
  await expect(page.getByTestId("current-chapter-summary")).toContainText(/watch path|Lantern Sigil/i, { timeout: slowTimeout });
  await expect(page.getByTestId("plaza-figures-stream")).toContainText(/Lamplighter Sera/i, { timeout: slowTimeout });
  await expect(page.getByTestId("recent-travel-history")).toContainText(/Watch Path|watch path|巡回路/i, {
    timeout: slowTimeout,
  });

  await submitChoice("progress");
  await expect(page.getByTestId("latest-reaction")).toContainText(/watch|巡回|Lantern|Sigil/i, { timeout: slowTimeout });
  await expect(page.getByTestId("recent-world-beats")).toContainText(/Lamplighter Sera|Watch Path|watch/i, { timeout: slowTimeout });
  await expect(page.getByTestId("recent-scene-history")).not.toContainText("No scene echoes", { timeout: slowTimeout });

  await page.evaluate(() => {
    window.history.pushState({}, "", "/admin");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByTestId("ops-status")).toContainText("ready", { timeout: slowTimeout });
  await expect(page.getByTestId("sp-admin-separation-note")).toContainText("separate");
  await expect(page.getByTestId("langfuse-status-summary")).toContainText(/langfuse/i, { timeout: slowTimeout });
  await expect(page.locator('[data-testid^="council-trace-link-"]').first()).toHaveAttribute(
    "href",
    /localhost:3001\/project\/gestaloka-v2\/traces\//i,
    {
      timeout: slowTimeout,
    },
  );
  await expect(page.getByTestId("location-route-stream")).toContainText(/Founders Square|Archive Steps|Watch Path/i, { timeout: slowTimeout });
  await expect(page.getByTestId("travel-log-stream")).toContainText(/Archive Steps|Watch Path/i, { timeout: slowTimeout });
  await expect(page.getByTestId("npc-routine-stream")).toContainText(/Archivist Nera|Lamplighter Sera|Courier Pell/i, { timeout: slowTimeout });
  await expect(page.getByTestId("ambient-beat-stream")).toContainText(/observe|murmur|reassure|question|withdraw/i, { timeout: slowTimeout });
  await expect(page.getByTestId("scene-timeline-stream")).toContainText(/active|closed|cooling|pressure|reveal|establish/i, {
    timeout: slowTimeout,
  });
});
