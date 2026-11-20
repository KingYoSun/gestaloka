import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures.js";
import { connectDatabases } from "@gestaloka/server";
import { WorldStore } from "@gestaloka/server/world";
import type { Page } from "@playwright/test";

const headers = { "X-Gestaloka-Request": "1" };
test.setTimeout(120000);
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

async function group(page: Page) {
  const { world, actors } = await village(page, 2),
    db = connectDatabases();
  const row = (
    await db.postgres.query(
      "SELECT world_id,root_ids FROM world_construction WHERE id=$1",
      [world],
    )
  ).rows[0];
  const call = async (actor: string, body: Record<string, unknown>) => {
    const response = await page.request.post(
      `/api/worlds/${world}/session?actorId=${actor}`,
      { headers, data: { requestId: randomUUID(), ...body } },
    );
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  for (const actor of actors) {
    await call(actor, { command: "start" });
    await call(actor, {
      command: "update",
      text: "合流場所へ移動する",
      operations: [
        {
          type: "locate",
          subjectId: actor,
          text: "合流場所",
          aboutIds: [row.root_ids[0]],
        },
      ],
      dependencies: [],
    });
    await call(actor, { command: "end-turn" });
  }
  await call(actors[1]!, { command: "contact", targetId: actors[0] });
  const count = async () =>
    Number(
      (
        await db.postgres.query(
          "SELECT count(*) AS n FROM llm_call WHERE world_id=$1",
          [row.world_id],
        )
      ).rows[0].n,
    );
  return { world, actors, call, count, db, graph: row.world_id };
}

test("実APIの手番・個別検索・チャット・本人の終了を狭い画面でも操作する", async ({
  page,
}) => {
  const f = await group(page),
    actor = f.actors[0]!,
    before = await f.count();
  try {
    await page.goto(`/worlds/${f.world}/play?actorId=${actor}`);
    await expect(
      page.getByRole("heading", { name: "2人のセッション" }),
    ).toBeVisible();
    const players = page.getByRole("complementary", { name: "プレイヤー情報" });
    await expect(players.getByRole("tab")).toHaveText([
      "基本情報",
      "所持品",
      "保管品",
      "技能",
      "過去の履歴",
    ]);
    const scene = page.getByRole("complementary", { name: "シーン情報" });
    await expect(scene.getByRole("listitem")).toHaveCount(2);
    const current = scene.getByRole("button", {
      name: /プロフィール（手番中）/,
    });
    const currentName = (await current.getAttribute("aria-label"))!.split(
      "のプロフィール",
    )[0]!;
    const timer = scene.locator(".turn-clock");
    await expect(timer).toHaveText(/^\d{2,}:\d{2}$/);
    await current.hover();
    await expect(page.getByRole("tooltip")).toHaveText(currentName);
    await current.click();
    await expect(page.getByRole("dialog", { name: currentName })).toBeVisible();
    await page.keyboard.press("Escape");
    await scene.getByRole("button", { name: "隣接する場所" }).click();
    await expect(
      page.getByRole("dialog", { name: "隣接する場所" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "自分の情報", exact: true }).click();
    await expect(
      page.getByText("自分への検索結果", { exact: true }),
    ).toBeVisible();
    const field = page.getByRole("textbox", {
      name: "発言・ターンコメント",
      exact: true,
    });
    await field.fill("次の観測を相談する");
    await field.dispatchEvent("compositionstart");
    await field.dispatchEvent("keydown", {
      key: "Enter",
      isComposing: true,
      keyCode: 229,
    });
    await field.dispatchEvent("compositionend");
    await page.getByRole("button", { name: "発言する", exact: true }).click();
    await expect(page.getByLabel("セッションのチャット")).not.toContainText(
      "次の観測を相談する",
    );
    await field.fill("自分の考えを添える");
    await page
      .getByRole("button", { name: "ターンコメントを付ける", exact: true })
      .click();
    await page
      .getByRole("button", { name: "手番を終える", exact: true })
      .click();
    await expect(page.getByLabel("セッションのチャット")).toContainText(
      "次の観測を相談する",
    );
    await expect(page.getByLabel("セッションのチャット")).toContainText(
      "自分の考えを添える",
    );
    const log = page.getByLabel("セッションのチャット");
    await expect(log.locator("time").last()).toHaveAttribute(
      "datetime",
      /^\d{4}-\d{2}-\d{2}T/,
    );
    await page.getByRole("button", { name: "最上部へ移動" }).click();
    await expect
      .poll(() => log.evaluate((element) => element.scrollTop))
      .toBe(0);
    await page.getByRole("button", { name: "最下部に移動" }).click();
    await expect
      .poll(() =>
        log.evaluate(
          (element) =>
            element.scrollHeight - element.clientHeight - element.scrollTop,
        ),
      )
      .toBeLessThanOrEqual(1);
    await page.screenshot({
      path: "artifacts/screenshots/bot-session-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const leftTrigger = page.locator('.play-drawer-trigger[data-side="left"]');
    const rightTrigger = page.locator(
      '.play-drawer-trigger[data-side="right"]',
    );
    for (const trigger of [leftTrigger, rightTrigger]) {
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveCSS("position", "fixed");
      await expect(trigger).toHaveCSS("bottom", "12px");
    }
    await expect(leftTrigger).toHaveCSS("left", "12px");
    await expect(rightTrigger).toHaveCSS("right", "12px");
    await rightTrigger.click();
    const sceneDrawer = page.getByRole("dialog", { name: "シーン情報" });
    await expect(sceneDrawer).toBeVisible();
    await expect(sceneDrawer.locator(".turn-clock")).toHaveText(
      /^\d{2,}:\d{2}$/,
    );
    await expect(page.locator(".play-drawer-trigger:visible")).toHaveCount(0);
    await page.keyboard.press("Escape");
    const swipe = (source: typeof log, from: number, to: number) =>
      source.evaluate(
        (target, { from, to }) => {
          const touch = (clientX: number) =>
            new Touch({ identifier: 1, target, clientX, clientY: 180 });
          target.dispatchEvent(
            new TouchEvent("touchstart", {
              bubbles: true,
              touches: [touch(from)],
              changedTouches: [touch(from)],
            }),
          );
          target.dispatchEvent(
            new TouchEvent("touchend", {
              bubbles: true,
              changedTouches: [touch(to)],
            }),
          );
        },
        { from, to },
      );
    const drawer = page.getByRole("dialog", { name: "プレイヤー情報" });
    await swipe(log, 28, 150);
    await expect(drawer).toBeVisible();
    await expect(page.locator(".play-drawer-trigger:visible")).toHaveCount(0);
    await swipe(drawer, 170, 35);
    await expect(drawer).toBeHidden();
    await expect(page.locator(".play-drawer-trigger:visible")).toHaveCount(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "artifacts/screenshots/bot-session-mobile.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "本人のシーンを終了", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "本人のシーンを終了しました" }),
    ).toBeVisible();
    await f.call(actor, { command: "start" });
    await page
      .getByRole("button", { name: "プレイヤー情報", exact: true })
      .click();
    await drawer.getByRole("tab", { name: "過去の履歴" }).click();
    await expect(drawer.getByRole("link", { name: /開始$/ })).toHaveCount(1);
    await drawer.getByRole("link", { name: /開始$/ }).click();
    await expect(
      page.getByRole("heading", { name: "過去のプレイログ" }),
    ).toBeVisible();
    await expect(log).toContainText("次の観測を相談する");
    await expect
      .poll(() => log.evaluate((element) => element.scrollTop))
      .toBe(0);
    expect(
      (
        await (
          await page.request.get(
            `/api/worlds/${f.world}/session?actorId=${f.actors[1]}`,
          )
        ).json()
      ).sessionId,
    ).toBeTruthy();
    expect(await f.count()).toBe(before);
  } finally {
    await f.db.close();
  }
});

test("受領判断と別枠のコメントを表示し、判断後は元の手番へ戻る", async ({
  page,
}) => {
  const f = await group(page),
    [sender, receiver] = f.actors as [string, string],
    store = new WorldStore(f.db.graph),
    item = randomUUID(),
    before = await f.count();
  try {
    await store.commit(
      await store.claim(f.graph, randomUUID()),
      store.context(f.graph),
      {
        commitId: randomUUID(),
        at: 0,
        changes: {
          nodes: [{ id: item, kind: "existence", text: "手渡す星図" }],
          edges: [
            {
              id: randomUUID(),
              kind: "has",
              role: "hold",
              source: sender,
              target: item,
              period: { from: 0 },
            },
          ],
          revisions: [],
          endEdges: [],
        },
      },
    );
    await f.call(sender, {
      command: "update",
      text: "星図を手渡す",
      operations: [
        {
          type: "move",
          item,
          from: sender,
          to: receiver,
          basis: "手渡しの申請",
        },
      ],
      dependencies: [],
    });
    await page.goto(`/worlds/${f.world}/play?actorId=${receiver}`);
    await expect(
      page.getByRole("button", { name: "受け入れる", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("ターンコメント", { exact: true })
      .fill("この判断へのコメント");
    await page
      .getByRole("button", { name: "ターンコメントを付ける", exact: true })
      .click();
    await page.getByRole("button", { name: "受け入れる", exact: true }).click();
    await expect(page.getByText(/の手番を待っています/)).toBeVisible();
    expect(
      (
        await (
          await page.request.get(
            `/api/worlds/${f.world}/session?actorId=${sender}`,
          )
        ).json()
      ).actorId,
    ).toBe(sender);
    expect(await f.count()).toBe(before);
  } finally {
    await f.db.close();
  }
});
