import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures.js";

test("Webでは共有を明示的に選び、参加者確定後もあらすじを読んでから開始する", async ({
  page,
}) => {
  const headers = { "X-Gestaloka-Request": "1" };
  const created = await page.request.post("/api/worlds", {
    headers,
    data: {
      requestId: randomUUID(),
      prompt: "共有シーンの画面を確認する世界",
      budgetUsd: 100,
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const world = (await created.json()).id;
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/worlds/${world}`)).json()).state,
    )
    .toBe("ready");
  expect(
    (
      await page.request.post(`/api/worlds/${world}/commands`, {
        headers,
        data: { requestId: randomUUID(), command: "finish" },
      })
    ).ok(),
  ).toBe(true);
  const operate = (command: object, requestId = randomUUID()) =>
    page.request.post("/api/operations", {
      headers,
      data: { requestId, command },
    });
  expect(
    (
      await operate({
        operation: "worlds.configure",
        worldId: world,
        title: "共有の画面",
        description: "",
        published: true,
        accepting: true,
        reason: "E2E",
      })
    ).ok(),
  ).toBe(true);
  const presetId = randomUUID();
  expect(
    (
      await operate({
        operation: "presets.put",
        presetId,
        title: "村民",
        description: "",
        settings: "この世界で暮らす",
        expectedVersion: 0,
        reason: "E2E",
      })
    ).ok(),
  ).toBe(true);
  const requestId = randomUUID();
  expect(
    (
      await operate(
        {
          operation: "worlds.join",
          worldId: world,
          presetId,
          presetVersion: 1,
        },
        requestId,
      )
    ).ok(),
  ).toBe(true);
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/worlds/${world}/players/${requestId}`)
          ).json()
        ).player?.state,
      { timeout: 30000 },
    )
    .toBe("ready");
  const actor = (
    await (
      await page.request.get(`/api/worlds/${world}/players/${requestId}`)
    ).json()
  ).player.actorId;
  await page.goto(`/worlds/${world}/play?actorId=${actor}`);
  const shared = page.getByLabel("共有シーンとして参加を求める");
  await expect(shared).not.toBeChecked();
  await shared.check();
  await page.getByLabel("次のシーンで何をしたいですか").fill("周囲を確かめる");
  await page
    .getByRole("button", { name: "シーンのあらすじを準備する" })
    .click();
  await expect(
    page.getByRole("heading", { name: "シーンのあらすじ" }),
  ).toBeVisible();
  expect(
    (
      await (
        await page.request.get(`/api/worlds/${world}/scene?actorId=${actor}`)
      ).json()
    ).scene.shared.phase,
  ).toBe("settled");
  await expect(page.getByLabel("どう行動しますか")).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/screenshots/shared-scene-ready.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "シーンを始める" }).click();
  await expect(page.getByLabel("どう行動しますか")).toBeVisible();
});
