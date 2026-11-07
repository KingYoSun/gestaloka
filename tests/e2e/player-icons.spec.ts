import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, test } from "./fixtures.js";
import { connectDatabases } from "@gestaloka/server";
import { WorldStore } from "@gestaloka/server/world";
import { fixtureAuth } from "../support/auth.js";

test("参加時の画像を再読込後に再試行し、Web・共通APIの変更を相互の画面へ表示する", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120000);
  const red = await sharp({
    create: { width: 80, height: 120, channels: 3, background: "#c05050" },
  })
    .png()
    .toBuffer();
  const blue = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "#5080b0" },
  })
    .png()
    .toBuffer();
  const green = await sharp({
    create: { width: 80, height: 80, channels: 3, background: "#65785f" },
  })
    .png()
    .toBuffer();
  const post = async (command: object) => {
    const result = await page.request.post("/api/operations", {
      headers: { "x-gestaloka-request": "1" },
      data: { requestId: randomUUID(), command },
    });
    expect(result.ok(), await result.text()).toBe(true);
  };
  const created = await page.request.post("/api/worlds", {
    headers: { "x-gestaloka-request": "1" },
    data: {
      requestId: randomUUID(),
      prompt: "人物の顔を区別するための試験世界",
      budgetUsd: 100,
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const world = (await created.json()).id;
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/worlds/${world}`)).json()).state,
      { timeout: 30000 },
    )
    .toBe("ready");
  const finish = await page.request.post(`/api/worlds/${world}/commands`, {
    headers: { "x-gestaloka-request": "1" },
    data: { requestId: randomUUID(), command: "finish" },
  });
  expect(finish.ok(), await finish.text()).toBe(true);
  await post({
    operation: "worlds.configure",
    worldId: world,
    title: "顔で分かる村",
    description: "",
    published: true,
    accepting: true,
    reason: "検証",
  });
  const preset = randomUUID();
  await post({
    operation: "presets.put",
    presetId: preset,
    title: "村に暮らす",
    description: "",
    settings: "この村に暮らす",
    expectedVersion: 0,
    reason: "検証",
  });
  await page.goto(`/worlds/${world}`);
  await page
    .getByLabel("人物のアイコン（任意）")
    .setInputFiles({ name: "red.png", mimeType: "image/png", buffer: red });
  let uploads = 0,
    entry = "";
  await page.route(`**/api/worlds/${world}/players/*/icon`, async (route) => {
    entry = new URL(route.request().url()).pathname.split("/").at(-2)!;
    if (++uploads === 1)
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "INTERNAL_ERROR",
          message: "検証用の登録失敗",
        }),
      });
    else await route.continue();
  });
  await page
    .getByRole("button", { name: "この設定で参加する", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "画像の登録を再試行する", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("アイコンを保存しました。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "この人物で始める →", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  expect(
    (await (await page.request.get(`/api/worlds/${world}/players`)).json())
      .items,
  ).toHaveLength(1);
  const own = (
    await (
      await page.request.get(`/api/worlds/${world}/players/${entry}`)
    ).json()
  ).player;
  expect(own.icon).toMatch(/^data:image\/webp;base64,/);
  await page
    .getByRole("link", { name: "この人物で始める →", exact: true })
    .click();
  await page.goto(`/worlds/${world}`);
  const row = page.locator(`[data-player-id="${entry}"]`);
  await row.getByText("人物設定", { exact: true }).click();
  await row
    .getByLabel("人物のアイコン（任意）")
    .setInputFiles({ name: "green.png", mimeType: "image/png", buffer: green });
  await row
    .getByRole("button", { name: "画像を保存する", exact: true })
    .click();
  await expect(
    row.getByText("アイコンを保存しました。", { exact: true }),
  ).toBeVisible();
  const updated = (
    await (
      await page.request.get(`/api/worlds/${world}/players/${entry}`)
    ).json()
  ).player;
  expect(updated.icon).not.toBe(own.icon);
  await row.getByLabel("人物のアイコン（任意）").setInputFiles({
    name: "invalid.png",
    mimeType: "image/png",
    buffer: Buffer.from("invalid image"),
  });
  await row
    .getByRole("button", { name: "画像を保存する", exact: true })
    .click();
  await expect(
    row.getByText(
      "参加と以前のアイコンは保持されています。画像を選び直すか、再試行できます。",
    ),
  ).toBeVisible();
  expect(
    (
      await (
        await page.request.get(`/api/worlds/${world}/players/${entry}`)
      ).json()
    ).player.icon,
  ).toBe(updated.icon);
  await row
    .getByLabel("人物のアイコン（任意）")
    .setInputFiles({ name: "green.png", mimeType: "image/png", buffer: green });
  await row
    .getByRole("button", { name: "画像の登録を再試行する", exact: true })
    .click();
  await expect(
    row.getByText("アイコンを保存しました。", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/screenshots/player-icon-settings.png",
    fullPage: true,
  });

  const db = connectDatabases(),
    second = await browser.newContext({ baseURL: baseURL! });
  try {
    const auth = await fixtureAuth(db.postgres),
      person = await auth.person("user");
    await db.postgres.query("INSERT INTO e2e_subject(scope,id) VALUES($1,$2)", [
      process.env.E2E_SCOPE,
      person.id,
    ]);
    await second.addCookies([
      {
        name: "test_ory",
        value: person.id,
        url: baseURL!,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    const otherEntry = randomUUID();
    const join = await second.request.post("/api/operations", {
      headers: { "x-gestaloka-request": "1" },
      data: {
        requestId: otherEntry,
        command: {
          operation: "worlds.join",
          worldId: world,
          presetId: preset,
          presetVersion: 1,
        },
      },
    });
    expect(join.ok(), await join.text()).toBe(true);
    const upload = await second.request.put(
      `/api/worlds/${world}/players/${otherEntry}/icon`,
      {
        headers: { "x-gestaloka-request": "1" },
        data: { image: blue.toString("base64") },
      },
    );
    expect(upload.ok(), await upload.text()).toBe(true);
    const otherIcon = (await upload.json()).image;
    await expect
      .poll(
        async () =>
          (
            await (
              await second.request.get(
                `/api/worlds/${world}/players/${otherEntry}`,
              )
            ).json()
          ).player.state,
        { timeout: 30000 },
      )
      .toBe("ready");
    const other = (
      await (
        await second.request.get(`/api/worlds/${world}/players/${otherEntry}`)
      ).json()
    ).player;
    const hidden = await page.request.get(
      `/api/worlds/${world}/players/${otherEntry}`,
    );
    expect(await hidden.json()).toEqual({ player: null });
    expect(
      JSON.stringify(
        await (
          await page.request.get(
            `/api/worlds/${world}/knowledge?actorId=${own.actorId}`,
          )
        ).json(),
      ),
    ).not.toContain(otherIcon);
    const graph = (
      await db.postgres.query(
        "SELECT world_id FROM world_construction WHERE id=$1",
        [world],
      )
    ).rows[0].world_id;
    const store = new WorldStore(db.graph),
      commit = randomUUID();
    await store.commit(await store.claim(graph, commit), store.context(graph), {
      commitId: commit,
      at: 1,
      changes: {
        nodes: [],
        revisions: [],
        endEdges: [],
        edges: [
          {
            id: randomUUID(),
            kind: "see",
            source: own.actorId,
            target: other.actorId,
            text: `${other.name}に出会った。`,
            period: { from: 1 },
          },
          {
            id: randomUUID(),
            kind: "see",
            source: other.actorId,
            target: own.actorId,
            text: `${own.name}に出会った。`,
            period: { from: 1 },
          },
        ],
      },
    });
    await db.postgres.query("UPDATE world_construction SET at=1 WHERE id=$1", [
      world,
    ]);
    await page.goto(`/worlds/${world}/play?actorId=${own.actorId}`);
    await expect(
      page.getByRole("img", { name: `${other.name}のアイコン`, exact: true }),
    ).toHaveAttribute("src", otherIcon);
    const otherPage = await second.newPage();
    await otherPage.goto(`/worlds/${world}/play?actorId=${other.actorId}`);
    await expect(
      otherPage.getByRole("img", {
        name: `${own.name}のアイコン`,
        exact: true,
      }),
    ).toHaveAttribute("src", updated.icon);
    await page.screenshot({
      path: "artifacts/screenshots/player-icon-encounter.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "artifacts/screenshots/player-icon-mobile.png",
      fullPage: true,
    });
    // A decode/load failure must preserve the name and the default silhouette.
    const avatar = page.locator(".player-avatar").first();
    await avatar.locator("img").dispatchEvent("error");
    await expect(avatar.locator("svg")).toBeVisible();
    await page.goto(`/worlds/${world}`);
    await row.getByText("人物設定", { exact: true }).click();
    await row
      .getByRole("button", { name: "画像を解除する", exact: true })
      .click();
    await expect(row.locator(".player-avatar svg")).toBeVisible();
    expect(
      (
        await (
          await page.request.get(`/api/worlds/${world}/players/${entry}`)
        ).json()
      ).player.icon,
    ).toBeNull();
  } finally {
    await second.close();
    await db.close();
  }
});
