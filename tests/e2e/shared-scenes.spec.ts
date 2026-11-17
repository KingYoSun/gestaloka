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
    await page.screenshot({
      path: "artifacts/screenshots/bot-session-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
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
