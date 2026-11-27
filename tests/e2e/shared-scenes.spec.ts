import { randomBytes, randomUUID } from "node:crypto";
import { acceptWorldInvite, test, expect, worldInvite } from "./fixtures.js";
import { cliVersionHeader } from "../support/player-cli.js";
import { connectDatabases } from "@gestaloka/server";
import { WorldStore } from "@gestaloka/server/world";
import type { Page } from "@playwright/test";
import { fixtureAuth } from "../support/auth.js";

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
  await acceptWorldInvite(page.request, await worldInvite(page.request, world));
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

test("アカウントの公開設定と共有URLで観戦し、非公開に戻すと閲覧が止まる", async ({
  page,
  browser,
  baseURL,
}) => {
  const { world, actors } = await village(page);
  const actor = actors[0]!;
  const play = `/worlds/${world}/play?actorId=${actor}`;
  const watch = new URL(`/worlds/${world}/watch/${actor}`, baseURL);
  const send = async (
    command:
      { command: "start" | "end-turn" } | { command: "say"; text: string },
  ) => {
    const response = await page.request.post(
      `/api/worlds/${world}/session?actorId=${actor}`,
      { headers, data: { requestId: randomUUID(), ...command } },
    );
    expect(response.ok(), await response.text()).toBe(true);
  };
  await send({ command: "start" });
  await send({ command: "say", text: "広場から鐘の音が聞こえる" });
  await send({ command: "end-turn" });

  const watcher = await browser.newContext();
  const anonymous = await browser.newContext();
  const db = connectDatabases();
  try {
    const auth = await fixtureAuth(db.postgres);
    const { id } = await auth.person("user");
    await db.postgres.query("INSERT INTO e2e_subject(scope,id) VALUES($1,$2)", [
      process.env.E2E_SCOPE,
      id,
    ]);
    await watcher.addCookies([
      { name: "test_ory", value: id, url: watch.origin, httpOnly: true },
    ]);
    const observer = await watcher.newPage();
    const log = observer.getByLabel("セッションのチャット");
    const denied = observer
      .getByRole("alert")
      .getByText("このプレイは観戦できません");
    await observer.goto(watch.href);
    await expect(denied).toBeVisible();
    await expect(log).toBeHidden();

    await page.goto(play);
    const copy = page.getByRole("button", { name: "観戦URLをコピー" });
    await expect(page.getByLabel("セッションのチャット")).toBeVisible();
    await expect(copy).toBeHidden();
    await page.getByRole("link", { name: "アカウント設定" }).click();
    const visibility = page.getByRole("checkbox", {
      name: "他のユーザーからの観戦を許可する",
    });
    await expect(visibility).not.toBeChecked();
    await visibility.click();
    await expect(visibility).toBeChecked();
    await page.reload();
    await expect(visibility).toBeChecked();

    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(play);
    await page.bringToFront();
    await copy.click();
    await expect(page.getByText("観戦URLをコピーしました。")).toBeVisible();
    const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(sharedUrl).toBe(watch.href);

    const unauthenticated = await anonymous.newPage();
    await unauthenticated.goto(sharedUrl);
    const login = unauthenticated.getByRole("link", {
      name: "ログイン・利用登録へ",
    });
    await expect(login).toBeVisible();
    expect(
      new URL(
        (await login.getAttribute("href"))!,
        watch.origin,
      ).searchParams.get("return_to"),
    ).toBe(sharedUrl);

    await observer.goto(sharedUrl);
    await observer.bringToFront();
    await expect(log).toContainText("広場から鐘の音が聞こえる");
    await expect(
      observer.getByRole("button", { name: "発言する" }),
    ).toBeHidden();
    await send({ command: "say", text: "見張りが橋へ向かう" });
    await send({ command: "end-turn" });
    await expect(log).toContainText("見張りが橋へ向かう", { timeout: 10000 });

    await page.getByRole("link", { name: "アカウント設定" }).click();
    await visibility.click();
    await expect(visibility).not.toBeChecked();
    await observer.bringToFront();
    await expect(denied).toBeVisible({ timeout: 10000 });
    await expect(log).toBeHidden();
  } finally {
    await Promise.all([watcher.close(), anonymous.close(), db.close()]);
  }
});

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
      command: "apply",
      expectedSp: 0,
      action: {
        type: "direct",
        text: "合流場所へ移動する",
        operations: [
          {
            type: "locate",
            subjectId: actor,
            text: "合流場所",
            aboutIds: [row.root_ids[0]],
          },
        ],
      },
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
  return {
    world,
    actors,
    call,
    count,
    db,
    graph: row.world_id,
    place: row.root_ids[0] as string,
  };
}

test("実APIの手番・個別検索・チャット・本人の終了を狭い画面でも操作する", async ({
  page,
}) => {
  const f = await group(page),
    actor = f.actors[0]!,
    before = await f.count(),
    play = `/worlds/${f.world}/play?actorId=${actor}`,
    leave = page.getByRole("button", { name: "セッションを離れて続ける" }),
    finish = page.getByRole("button", { name: "自分のプレイを終了する" }),
    log = page.getByLabel("セッションのチャット");
  try {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.route(
      (url) =>
        url.pathname === `/api/worlds/${f.world}/session` &&
        url.searchParams.get("view") === "screen",
      async (route) => {
        const response = await route.fetch();
        const view = await response.json();
        view.screen.own.profile = Array.from(
          { length: 40 },
          (_, i) => `プロフィールの記録 ${i + 1}`,
        );
        await route.fulfill({ response, json: view });
      },
    );
    const logPosition = () =>
      log.evaluate((element) => ({
        top: element.getBoundingClientRect().top,
        pageScroll: window.scrollY,
        scrollTop: element.scrollTop,
      }));
    const pageFits = () =>
      page.evaluate(() => document.documentElement.scrollHeight <= innerHeight);
    const device = await page.request.post("/api/player-devices", {
      headers: { ...headers, ...cliVersionHeader },
      data: {
        requestId: randomUUID(),
        worldId: f.world,
        secret: randomBytes(32).toString("hex"),
      },
    });
    expect(device.ok(), await device.text()).toBe(true);
    await page.goto((await device.json()).verificationPath);
    await page.locator(`input[value="actor:${actor}"]`).check();
    await page
      .getByRole("button", { name: "この人物のプレイを許可する" })
      .click();
    await expect(page.getByText(/AIとの会話に戻り/)).toBeVisible();
    await page.goto(play);
    await expect(
      page.getByRole("heading", { name: "2人のセッション" }),
    ).toBeVisible();
    const players = page.getByRole("complementary", { name: "プレイヤー情報" });
    const lastProfile = players.getByText("プロフィールの記録 40");
    await expect(lastProfile).toBeAttached();
    expect(await pageFits()).toBe(true);
    const desktopPosition = await logPosition();
    await lastProfile.scrollIntoViewIfNeeded();
    await expect(lastProfile).toBeInViewport();
    expect(
      await players.evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0);
    expect(await logPosition()).toEqual(desktopPosition);
    await players.getByRole("tab", { name: "所持品" }).click();
    expect(await logPosition()).toEqual(desktopPosition);
    await page.getByRole("button", { name: "操作", exact: true }).click();
    for (const action of [
      leave,
      finish,
      page.getByText("プレイコマンド", { exact: true }),
      page.getByRole("button", { name: "分離して続ける", exact: true }),
    ]) {
      await expect(action).toHaveCount(0);
    }
    await page.keyboard.press("Escape");
    await page.goto("/auth/player");
    await page.getByRole("button", { name: "許可を解除する" }).click();
    await page.goto(play);
    await expect(
      page.getByRole("heading", { name: "2人のセッション" }),
    ).toBeVisible();
    await expect(players.getByRole("tab")).toHaveText([
      "基本情報",
      "所持品",
      "保管品",
      "技能",
      "過去の履歴",
      "通知",
    ]);
    const scene = page.getByRole("complementary", { name: "セッション情報" });
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
    await page.getByRole("button", { name: "操作", exact: true }).click();
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
    await expect(log.locator("time").last()).toHaveAttribute(
      "datetime",
      /^\d{4}-\d{2}-\d{2}T/,
    );
    await page.keyboard.press("Escape");
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
    const sceneDrawer = page.getByRole("dialog", { name: "セッション情報" });
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
    const mobilePosition = await logPosition();
    await drawer.getByRole("tab", { name: "所持品" }).click();
    expect(await logPosition()).toEqual(mobilePosition);
    await drawer.getByRole("tab", { name: "基本情報" }).click();
    expect(await logPosition()).toEqual(mobilePosition);
    await swipe(drawer, 170, 35);
    await expect(drawer).toBeHidden();
    await expect(page.locator(".play-drawer-trigger:visible")).toHaveCount(2);
    expect(await pageFits()).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "artifacts/screenshots/bot-session-mobile.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "操作", exact: true }).click();
    await leave.click();
    await expect(
      page.getByRole("heading", {
        name: "1人のセッション",
        includeHidden: true,
      }),
    ).toBeVisible();
    await field.fill("単独で観測を続ける");
    await page.getByRole("button", { name: "発言する", exact: true }).click();
    await finish.click();
    await expect(
      page.getByRole("heading", {
        name: "今回のプレイを終了しました",
        includeHidden: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
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
    await expect(page.getByText("プレイコマンド", { exact: true })).toHaveCount(
      0,
    );
    await expect(log).toContainText("次の観測を相談する");
    await expect(log).toContainText("単独で観測を続ける");
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

test("保管品をバンドルにまとめ、状態を見て1本を取り出せる", async ({
  page,
}) => {
  const f = await group(page);
  const actor = f.actors[0]!;
  const store = new WorldStore(f.db.graph);
  const dry = randomUUID(),
    wet = randomUUID(),
    state = randomUUID();
  const has = (source: string, target: string, role?: "use") => ({
    id: randomUUID(),
    kind: "has" as const,
    source,
    target,
    role,
    period: { from: 0 },
  });
  try {
    await store.commit(
      await store.claim(f.graph, randomUUID()),
      store.context(f.graph),
      {
        commitId: randomUUID(),
        at: 0,
        changes: {
          nodes: [
            { id: dry, kind: "existence", text: "手前の杉材" },
            { id: wet, kind: "existence", text: "奥の杉材" },
            { id: state, kind: "script", text: "乾燥済み" },
          ],
          edges: [
            has(actor, f.place, "use"),
            has(f.place, dry),
            has(f.place, wet),
            {
              id: randomUUID(),
              kind: "status",
              role: "content",
              source: dry,
              target: state,
              period: { from: 0 },
            },
          ],
          revisions: [],
          endEdges: [],
        },
      },
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/worlds/${f.world}/play?actorId=${actor}`);
    await page
      .getByRole("button", { name: "プレイヤー情報", exact: true })
      .click();
    const drawer = page.getByRole("dialog", { name: "プレイヤー情報" });
    await drawer.getByRole("tab", { name: "保管品" }).click();
    await expect(drawer.getByText("使用枠 2/150")).toBeVisible();
    await drawer.getByText("品をまとめる", { exact: true }).click();
    await drawer.getByLabel("名前", { exact: true }).fill("小屋の建材");
    await drawer.getByRole("checkbox", { name: "手前の杉材" }).check();
    await drawer.getByRole("checkbox", { name: "奥の杉材" }).check();
    await drawer.getByRole("button", { name: "選んだ品をまとめる" }).click();
    await expect(drawer.getByText("使用枠 1/150")).toBeVisible();
    await drawer.getByText("小屋の建材 · 2点 · 1枠", { exact: true }).click();
    const dryRow = drawer
      .getByRole("listitem")
      .filter({ has: page.getByText("手前の杉材", { exact: true }) });
    await expect(dryRow.getByText("乾燥済み", { exact: true })).toBeVisible();
    await dryRow.getByRole("button", { name: "手持ちへ取り出す" }).click();
    await expect(drawer.getByText("小屋の建材 · 1点 · 1枠")).toBeVisible();
    await expect(dryRow).toHaveCount(0);
    await drawer.getByRole("tab", { name: "所持品" }).click();
    await expect(drawer.getByText("手前の杉材", { exact: true })).toBeVisible();
    const ctx = store.context(f.graph);
    expect(
      (await ctx.relations(dry, "has", "in", Number.MAX_SAFE_INTEGER)).some(
        (edge) => edge.source === actor && !edge.role,
      ),
    ).toBe(true);
    expect(
      (await ctx.relations(dry, "status", "out", Number.MAX_SAFE_INTEGER)).some(
        (edge) => edge.target === state,
      ),
    ).toBe(true);
  } finally {
    await f.db.close();
  }
});

test("プレイヤーは保管先の枠の内訳を読み、入れ物の続きを開ける", async ({
  page,
}) => {
  const {
    world,
    actors: [actor],
  } = await village(page);
  const db = connectDatabases();
  const store = new WorldStore(db.graph);
  const storage = randomUUID(),
    outer = randomUUID(),
    inner = randomUUID();
  const has = (source: string, target: string, role?: "use") => ({
    id: randomUUID(),
    kind: "has" as const,
    source,
    target,
    role,
    period: { from: 0 },
  });
  const records = Array.from({ length: 51 }, (_, i) => ({
    id: randomUUID(),
    kind: "existence" as const,
    text: `採集記録 ${i + 1}`,
  }));
  try {
    const graph = (
      await db.postgres.query(
        "SELECT world_id FROM world_construction WHERE id=$1",
        [world],
      )
    ).rows[0].world_id as string;
    const needle = randomUUID();
    await store.commit(
      await store.claim(graph, randomUUID()),
      store.context(graph),
      {
        commitId: randomUUID(),
        at: 0,
        changes: {
          nodes: [
            { id: storage, kind: "existence", text: "資料庫" },
            { id: outer, kind: "existence", text: "記録の箱" },
            { id: inner, kind: "existence", text: "針の小箱" },
            { id: needle, kind: "existence", text: "縫い針" },
            ...records,
          ],
          edges: [
            has(actor!, storage, "use"),
            has(storage, outer),
            has(outer, inner),
            has(inner, needle),
            ...records.map(({ id }) => has(outer, id)),
          ],
          revisions: [],
          endEdges: [],
        },
      },
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/worlds/${world}/play?actorId=${actor}`);
    await page
      .getByRole("button", { name: "プレイヤー情報", exact: true })
      .click();
    const drawer = page.getByRole("dialog", { name: "プレイヤー情報" });
    await drawer.getByRole("tab", { name: "保管品" }).click();
    await expect(drawer.getByText("使用枠 54/150")).toBeVisible();
    await expect(drawer.getByText("54枠（本体1枠・中身53枠）")).toBeVisible();
    await drawer.getByText("中身を見る", { exact: true }).click();
    await drawer.getByRole("button", { name: "中身をさらに読む" }).click();
    await expect(drawer.getByText(/^採集記録 \d+$/)).toHaveCount(51);
    await expect(
      drawer.getByRole("button", { name: "中身をさらに読む" }),
    ).toHaveCount(0);
    await drawer
      .getByRole("listitem")
      .filter({ has: page.getByText("針の小箱", { exact: true }) })
      .last()
      .getByText("中身を見る")
      .click();
    await expect(drawer.getByText("縫い針", { exact: true })).toBeVisible();
  } finally {
    await db.close();
  }
});

test("手動プレイでドロワーと同じ候補から物品を手渡して移動できる", async ({
  page,
}) => {
  const f = await group(page),
    [sender, receiver] = f.actors as [string, string],
    store = new WorldStore(f.db.graph),
    item = randomUUID(),
    marking = randomUUID(),
    secret = randomUUID(),
    notes = Array.from({ length: 50 }, (_, i) => ({
      id: randomUUID(),
      kind: "script" as const,
      text: `観測印 ${i + 1}`,
    })),
    place = randomUUID(),
    route = randomUUID(),
    before = await f.count();
  try {
    await store.commit(
      await store.claim(f.graph, randomUUID()),
      store.context(f.graph),
      {
        commitId: randomUUID(),
        at: 0,
        changes: {
          nodes: [
            { id: item, kind: "existence", text: "手渡す星図" },
            { id: marking, kind: "script", text: "北極星に銀の印がある" },
            ...notes,
            {
              id: secret,
              kind: "script",
              text: "裏面の暗号",
              viewers: [sender],
            },
            { id: place, kind: "existence", text: "星を観測する丘" },
            { id: route, kind: "script", text: "合流場所から丘へ続く道" },
          ],
          edges: [
            {
              id: randomUUID(),
              kind: "has",
              source: sender,
              target: item,
              text: "師匠と冬の空を観測して描いた",
              period: { from: 0 },
            },
            ...[marking, secret, ...notes.map((note) => note.id)].map(
              (target) => ({
                id: randomUUID(),
                kind: "status" as const,
                role: "content" as const,
                source: item,
                target,
                period: { from: 0 },
              }),
            ),
            {
              id: randomUUID(),
              kind: "status",
              role: "content",
              text: "route",
              source: f.place,
              target: route,
              period: { from: 0 },
            },
            {
              id: randomUUID(),
              kind: "status",
              role: "about",
              source: route,
              target: place,
              period: { from: 0 },
            },
          ],
          revisions: [],
          endEdges: [],
        },
      },
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const playerDrawer = page.getByRole("dialog", { name: "プレイヤー情報" });
    const openPlayer = async () => {
      await page
        .getByRole("button", { name: "プレイヤー情報", exact: true })
        .click();
      await playerDrawer.getByRole("tab", { name: "所持品" }).click();
    };
    await page.goto(`/worlds/${f.world}/play?actorId=${sender}`);
    await openPlayer();
    await expect(
      playerDrawer.getByText("手渡す星図", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "操作", exact: true }).click();
    await page.getByText("プレイコマンド", { exact: true }).click();
    await page.getByLabel("手渡す物品").selectOption({ label: "手渡す星図" });
    await page.getByLabel("渡す相手").selectOption(receiver);
    await page.getByRole("button", { name: "手渡す", exact: true }).click();
    await expect(
      page.getByText("申請を受け付けました。受領判断を待っています", {
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(`/worlds/${f.world}/play?actorId=${receiver}`);
    await page.getByRole("button", { name: "操作", exact: true }).click();
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
    await page.keyboard.press("Escape");
    await openPlayer();
    await expect(
      playerDrawer.getByText("手渡す星図", { exact: true }),
    ).toBeVisible();
    await playerDrawer
      .getByRole("listitem")
      .filter({ hasText: "手渡す星図" })
      .getByText("説明を見る")
      .click();
    await expect(
      playerDrawer.getByText("師匠と冬の空を観測して描いた"),
    ).toBeVisible();
    await playerDrawer
      .getByRole("button", { name: "説明の続きを見る" })
      .click();
    await expect(playerDrawer.getByText(/^観測印 \d+$/)).toHaveCount(50);
    await expect(playerDrawer.getByText("北極星に銀の印がある")).toBeVisible();
    await expect(playerDrawer.getByText("裏面の暗号")).toHaveCount(0);
    expect(
      (
        await page.request.get(
          `/api/worlds/${f.world}/inventory/description?actorId=${sender}&itemId=${item}`,
        )
      ).status(),
    ).toBe(404);
    const holders = await store
      .context(f.graph)
      .relations(item, "has", "in", Number.MAX_SAFE_INTEGER);
    expect(holders.find((edge) => !edge.role)?.source).toBe(receiver);
    expect(
      (
        await (
          await page.request.get(
            `/api/worlds/${f.world}/session?actorId=${sender}`,
          )
        ).json()
      ).actorId,
    ).toBe(sender);
    await page.goto(`/worlds/${f.world}/play?actorId=${sender}`);
    const sceneDrawer = page.getByRole("dialog", { name: "セッション情報" });
    const openScene = () =>
      page.getByRole("button", { name: "セッション情報", exact: true }).click();
    await openScene();
    await sceneDrawer.getByRole("button", { name: "隣接する場所" }).click();
    await expect(
      page
        .getByRole("dialog", { name: "隣接する場所" })
        .getByText("星を観測する丘", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "操作", exact: true }).click();
    await page.getByText("プレイコマンド", { exact: true }).click();
    await page.getByLabel("移動先").selectOption({ label: "星を観測する丘" });
    await page.getByRole("button", { name: "移動する", exact: true }).click();
    await expect(
      page.getByText("申請した変更を確定しました", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await openScene();
    await expect(
      sceneDrawer.getByText("星を観測する丘", { exact: true }),
    ).toBeVisible();
    expect(await f.count()).toBe(before);
  } finally {
    await f.db.close();
  }
});
