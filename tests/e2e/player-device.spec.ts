import { randomBytes, randomUUID } from "node:crypto";
import { connectDatabases } from "@gestaloka/server";
import { test, expect, worldInvite } from "./fixtures.js";
import { cliVersionHeader } from "../support/player-cli.js";

test("持ち主が確認コードで新規参加を許可し、ブラウザーで解除できる", async ({
  page,
}) => {
  const headers = { "X-Gestaloka-Request": "1" };
  const created = await page.request.post("/api/worlds", {
    headers,
    data: {
      requestId: randomUUID(),
      prompt: "CLIの認可画面を確認する世界",
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
  const operation = (command: object) =>
    page.request.post("/api/operations", {
      headers,
      data: { requestId: randomUUID(), command },
    });
  expect(
    (
      await operation({
        operation: "worlds.configure",
        worldId: world,
        title: "認可を確認する村",
        description: "Museの村民を選びます",
        published: true,
        accepting: true,
        reason: "E2E",
      })
    ).ok(),
  ).toBe(true);
  const presetId = randomUUID();
  expect(
    (
      await operation({
        operation: "presets.put",
        presetId,
        title: "村で暮らす人",
        description: "この村で新しく参加する",
        settings: "この世界に暮らす人物",
        expectedVersion: 0,
        reason: "E2E",
      })
    ).ok(),
  ).toBe(true);
  const id = randomUUID(),
    secret = randomBytes(32).toString("hex");
  const pairing = await page.request.post("/api/player-devices", {
    headers: { ...headers, ...cliVersionHeader },
    data: { requestId: id, worldId: world, secret },
  });
  expect(pairing.ok(), await pairing.text()).toBe(true);
  const code = await pairing.json();
  const invitation = await worldInvite(page.request, world);
  await page.goto(
    `${code.verificationPath}&invitation=${encodeURIComponent(invitation)}`,
  );
  await page.getByRole("button", { name: "招待を受け取る" }).click();
  await expect(
    page.getByRole("heading", { name: "AIにプレイを許可する" }),
  ).toBeVisible();
  await expect(page.getByText(code.userCode, { exact: true })).toBeVisible();
  await page
    .getByLabel("新規参加: 村で暮らす人 — この村で新しく参加する")
    .check();
  await page.getByLabel("新しく作る人物のリスポーンを無効にする").check();
  await page.screenshot({
    path: "artifacts/screenshots/player-device-consent.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "この人物のプレイを許可する" })
    .click();
  await expect(
    page.getByRole("heading", { name: "プレイを許可しました" }),
  ).toBeVisible();
  const bearer = { authorization: `Bearer ${secret}`, ...cliVersionHeader };
  expect(
    (
      await (
        await page.request.get("/api/player-device", { headers: bearer })
      ).json()
    ).state,
  ).toBe("authorized");
  const join = {
    requestId: id,
    command: {
      operation: "worlds.join",
      worldId: world,
      presetId,
      presetVersion: 1,
    },
  };
  const tampered = await page.request.post("/api/operations", {
    headers: { ...headers, ...bearer },
    data: { ...join, command: { ...join.command, disableRespawn: false } },
  });
  expect(tampered.status()).toBe(403);
  expect((await tampered.json()).code).toBe("PLAYER_DEVICE_SCOPE");
  const joined = await page.request.post("/api/operations", {
    headers: { ...headers, ...bearer },
    data: join,
  });
  expect(joined.ok(), await joined.text()).toBe(true);
  const db = connectDatabases();
  try {
    const { rows } = await db.postgres.query(
      "SELECT respawn_disabled FROM world_join WHERE id=$1",
      [id],
    );
    expect(rows).toEqual([{ respawn_disabled: true }]);
  } finally {
    await db.close();
  }
  await page.getByRole("link", { name: "許可を確認・解除する" }).click();
  await expect(
    page.getByText(`接続: ${code.userCode}`, { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/screenshots/player-device-grants.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "許可を解除する" }).click();
  expect(
    (
      await page.request.get("/api/player-device", { headers: bearer })
    ).status(),
  ).toBe(403);
});
