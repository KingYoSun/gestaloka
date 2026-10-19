import { expect, test } from "@playwright/test";

test("構築・追加進行・完了・別村民の行動を実APIと独立ワーカーで再開する", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("世界の初期設定")
    .fill("一つの村と村民のための初期設定");
  await page
    .getByRole("button", { name: "初期世界を生成する", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "試遊を進める", exact: true }),
  ).toBeVisible();
  await page.getByLabel("さらに進める日数", { exact: true }).fill("2");
  await page.getByRole("button", { name: "試遊を進める", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "さらに進める", exact: true }),
  ).toBeVisible();
  await page.getByLabel("さらに進める日数", { exact: true }).fill("1");
  await page.getByRole("button", { name: "さらに進める", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "世界構築を完了する", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".time-summary")).toContainText("3日");
  await page
    .getByRole("button", { name: "世界構築を完了する", exact: true })
    .click();
  await page
    .getByRole("button", { name: "別の村民として参加する", exact: true })
    .click();
  await page
    .getByRole("link", { name: "村民の画面を開く", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "村民として", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("あなたが初めて知覚した景色", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("INTERNAL_GM_ONLY");
  await expect(page.locator("body")).not.toContainText("PRIVATE_");
  let posted = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/actions"))
      posted++;
  });
  const field = page.getByLabel("どう行動しますか", { exact: true });
  const input = "周囲を見渡す。\n見える範囲を確かめる。";
  await field.fill(input);
  await field.dispatchEvent("compositionstart");
  await field.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    ctrlKey: true,
    isComposing: true,
    keyCode: 229,
  });
  await field.dispatchEvent("compositionend");
  expect(posted).toBe(0);
  const accepted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/actions"),
  );
  await page
    .getByRole("button", { name: "この行動を送る", exact: true })
    .click();
  const response = await accepted;
  expect(response.status()).toBe(202);
  const result = await response.json();
  expect(result.runId).toBeTruthy();
  await page.reload();
  await expect(page.getByText(input, { exact: true })).toBeVisible();
  await expect(page.getByText(/公開された経験/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "この行動を送る", exact: true }),
  ).toBeEnabled();
  expect(posted).toBe(1);
});

test("狭い画面で入力・閲覧・テーマ切替ができる", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByLabel("世界の初期設定")).toBeVisible();
  const toggle = page.getByRole("button", { name: /モードに切り替える/ });
  const before = await page.locator("html").getAttribute("class");
  await toggle.click();
  await expect
    .poll(() => page.locator("html").getAttribute("class"))
    .not.toBe(before);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("長い履歴の保持と描画を制限し、ページ破棄でも閲覧位置を保つ", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("世界の初期設定").fill("履歴の検証用の世界");
  await page
    .getByRole("button", { name: "初期世界を生成する", exact: true })
    .click();
  await page.getByLabel("さらに進める日数", { exact: true }).fill("1");
  await page.getByRole("button", { name: "試遊を進める", exact: true }).click();
  await page
    .getByRole("button", { name: "世界構築を完了する", exact: true })
    .click();
  await page
    .getByRole("button", { name: "別の村民として参加する", exact: true })
    .click();
  await page.getByRole("link", { name: /村民の画面を開く/ }).click();
  const section = page.getByRole("region", { name: "あなたの記録" }),
    scroll = page.getByLabel("記録の閲覧領域");
  await expect
    .poll(() => section.getAttribute("data-retained-records"))
    .toBe("50");
  for (let index = 0; index < 4; index++) {
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page
      .getByRole("button", { name: "古い記録を読む", exact: true })
      .click();
    await expect
      .poll(async () =>
        Number(await section.getAttribute("data-retained-records")),
      )
      .toBe(Math.min(200, (index + 2) * 50));
    await expect(
      page.getByText("記録を確認しています", { exact: true }),
    ).toBeHidden();
    expect(await scroll.locator("article").count()).toBeLessThan(20);
  }
  await scroll.evaluate(async (element) => {
    element.scrollTop = element.scrollHeight;
    // 仮想行の描画とResizeObserverによる高さの計測後に閲覧位置を読む。
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  const anchor = await scroll.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const item = [...element.querySelectorAll("article")].find(
      (row) => row.getBoundingClientRect().bottom > top + 8,
    )!;
    return {
      id: item.getAttribute("data-record-id"),
      offset: item.getBoundingClientRect().top - top,
    };
  });
  await page
    .getByRole("button", { name: "古い記録を読む", exact: true })
    .click();
  await expect(
    page.getByText("記録を確認しています", { exact: true }),
  ).toBeHidden();
  await expect
    .poll(() => scroll.locator(`[data-record-id="${anchor.id}"]`).count())
    .toBe(1);
  const offset = await scroll
    .locator(`[data-record-id="${anchor.id}"]`)
    .evaluate(
      (element) =>
        element.getBoundingClientRect().top -
        element.parentElement!.parentElement!.getBoundingClientRect().top,
    );
  expect(Math.abs(offset - anchor.offset)).toBeLessThan(5);
  expect(
    Number(await section.getAttribute("data-retained-records")),
  ).toBeLessThanOrEqual(200);
  await page.getByRole("button", { name: "最新へ", exact: true }).click();
  await expect(
    page.getByText("あなたが初めて知覚した景色", { exact: true }),
  ).toBeVisible();
});
