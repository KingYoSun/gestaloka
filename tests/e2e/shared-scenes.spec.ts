import { randomUUID, randomBytes } from "node:crypto";
import { test, expect } from "./fixtures.js";
import type { Page } from "@playwright/test";

const headers = { "X-Gestaloka-Request": "1" };
async function village(page: Page, count = 1) {
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
  const actors: string[] = [];
  for (let i = 0; i < count; i++) {
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
              await page.request.get(
                `/api/worlds/${world}/players/${requestId}`,
              )
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

    actors.push(actor);
  }
  return { world, actors };
}

test("Webでは共有を明示的に選び、参加者確定後もあらすじを読んでから開始する", async ({
  page,
}) => {
  const { world, actors } = await village(page);
  const actor = actors[0]!;
  await page.goto(`/worlds/${world}/play?actorId=${actor}`);
  await page.getByRole("button", { name: "自由入力" }).click();
  const shared = page.getByLabel("共有シーンとして参加を求める");
  await expect(shared).not.toBeChecked();
  await shared.check();
  await page.getByLabel("次のシーンで何をしたいですか").fill("周囲を確かめる");
  await page
    .getByRole("button", { name: "シーンのあらすじを準備する" })
    .click();
  await expect(
    page.getByRole("heading", { name: "シーンのあらすじ" }),
  ).toBeVisible({ timeout: 30000 });
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
  await expect(page.getByRole("button", { name: "自由入力" })).toBeEnabled();
  await page.getByRole("button", { name: "この場から退出する" }).click();
  await expect(
    page.getByRole("heading", { name: "リザルト", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "自由入力" }).click();
  await expect(page.getByLabel("次のシーンで何をしたいですか")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: "artifacts/screenshots/shared-scene-departed.png",
    fullPage: true,
  });
});

test("同席botへの反応機会をWebでも確認し、反応なしを一度だけ回答できる", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { world, actors } = await village(page, 2),
    owner = actors[0]!,
    bot = actors[1]!,
    secret = randomBytes(32).toString("hex");
  const created = await page.request.post("/api/player-devices", {
    headers,
    data: { requestId: randomUUID(), worldId: world, secret },
  });
  expect(created.ok()).toBe(true);
  const code = (await created.json()).userCode;
  const permit = await page.request.get(`/auth/player?code=${code}`),
    csrf = (await permit.text()).match(/name="csrf" value="([a-f0-9]+)"/)![1]!;
  expect(
    (
      await page.request.post("/auth/player", {
        form: { csrf, code, choice: `actor:${bot}` },
        maxRedirects: 0,
      })
    ).status(),
  ).toBe(302);
  const botHeaders = { ...headers, authorization: `Bearer ${secret}` };
  const online = await page.request.post(
    `/api/worlds/${world}/presence?actorId=${bot}`,
    {
      headers: botHeaders,
      data: {
        requestId: randomUUID(),
        connectionId: randomUUID(),
        active: true,
      },
    },
  );
  expect((await online.json()).kind).toBe("bot");
  await page.goto(`/worlds/${world}/play?actorId=${owner}`);
  await page.getByRole("button", { name: "自由入力" }).click();
  await page.getByLabel("共有シーンとして参加を求める").check();
  await page.getByLabel("次のシーンで何をしたいですか").fill("同席者と話す");
  await page
    .getByRole("button", { name: "シーンのあらすじを準備する" })
    .click();
  let invitation: { id: string } | undefined;
  await expect
    .poll(
      async () => {
        const inbox = await page.request.get(
          `/api/worlds/${world}/scene/inbox?actorId=${bot}`,
          { headers: botHeaders },
        );
        invitation = (await inbox.json()).invitations[0];
        return !!invitation;
      },
      { timeout: 20000 },
    )
    .toBe(true);
  expect(
    (
      await page.request.post(`/api/worlds/${world}/scene?actorId=${bot}`, {
        headers: botHeaders,
        data: {
          requestId: randomUUID(),
          command: "invite",
          invitationId: invitation!.id,
          accept: true,
        },
      })
    ).ok(),
  ).toBe(true);
  await page.getByRole("button", { name: "シーンを始める" }).click();
  await page.getByRole("button", { name: "自由入力" }).click();
  await page.getByLabel("どう行動しますか").fill("同席者へ声をかける");
  await page.getByRole("button", { name: "この行動を送る" }).click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(
              `/api/worlds/${world}/scene/inbox?actorId=${bot}`,
              { headers: botHeaders },
            )
          ).json()
        ).opportunities.length,
    )
    .toBe(1);
  await page.goto(`/worlds/${world}/play?actorId=${bot}`);
  await expect(
    page.getByRole("heading", { name: "返答を求められています" }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/screenshots/shared-scene-reaction.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "反応しない", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "返答を求められています" }),
  ).toHaveCount(0);
  expect(
    (
      await (
        await page.request.get(
          `/api/worlds/${world}/scene/inbox?actorId=${bot}`,
          { headers: botHeaders },
        )
      ).json()
    ).opportunities,
  ).toEqual([]);
  await page.goto(`/worlds/${world}/play?actorId=${owner}`);
  await page
    .getByRole("button", { name: "シーンを終えてリザルトを見る" })
    .click();
  await expect(
    page.getByRole("heading", { name: "リザルト", exact: true }),
  ).toBeVisible({ timeout: 20000 });
});
