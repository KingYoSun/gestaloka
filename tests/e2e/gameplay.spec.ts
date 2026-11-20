import { expect, test } from "./fixtures.js";
import { createHash, randomUUID } from "node:crypto";
import { connectDatabases } from "@gestaloka/server";
import type { Page } from "@playwright/test";

async function participate(page: Page) {
  await expect(page.getByText("世界構築を完了", { exact: true })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/")[2]!;
  const preset = await page.request.post("/api/operations", {
    headers: { "X-Gestaloka-Request": "1" },
    data: {
      requestId: randomUUID(),
      command: {
        operation: "presets.put",
        presetId: randomUUID(),
        expectedVersion: 0,
        title: "村民",
        description: "村に暮らす人物",
        settings: "この村に暮らす新しい村民",
        reason: "E2E参加設定",
      },
    },
  });
  expect(preset.ok(), await preset.text()).toBe(true);
  await page.getByLabel("公開用の名称", { exact: true }).fill("参加できる村");
  await page.getByLabel("登録済みの全員へ公開する", { exact: true }).check();
  await page.getByLabel("新しい参加を受け付ける", { exact: true }).check();
  await page
    .getByRole("button", { name: "公開・参加受付を保存する", exact: true })
    .click();
  await expect(
    page.getByText("公開・参加受付を保存しました。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "別の村民として参加する", exact: true }),
  ).toHaveCount(0);
  await page.goto(`http://127.0.0.1:4173/worlds/${id}`);
  await page
    .getByRole("button", { name: "この設定で参加する", exact: true })
    .click();
  await page
    .getByRole("link", { name: "この人物で始める →", exact: true })
    .click();
}

test("ログインだけでは匿名データを移行せず、対象確認と本人の操作で引き継ぐ", async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto("http://127.0.0.1:4174/");
  await page.getByLabel("世界の初期設定").fill("引き継ぐ対象の村");
  await page
    .getByLabel("この世界の予算上限（USD）", { exact: true })
    .fill("100");
  await page
    .getByRole("button", { name: "初期世界を生成する", exact: true })
    .click();
  await page
    .getByRole("button", { name: "世界構築を完了する", exact: true })
    .click();
  await participate(page);

  const world = new URL(page.url()).pathname.split("/")[2]!;
  const user = (await (await page.request.get("/api/session")).json()).id;
  const legacy = randomUUID(),
    token = randomUUID(),
    db = connectDatabases();
  try {
    const actor = (
      await db.postgres.query(
        "SELECT actor_id FROM world_access WHERE construction_id=$1 AND subject_id=$2 AND role='player'",
        [world, user],
      )
    ).rows[0].actor_id;
    await db.postgres.query(
      "INSERT INTO world_subject(id,token_hash) VALUES($1,$2)",
      [legacy, createHash("sha256").update(token).digest("hex")],
    );
    await db.postgres.query("INSERT INTO e2e_subject(scope,id) VALUES($1,$2)", [
      process.env.E2E_SCOPE,
      legacy,
    ]);
    for (const table of ["world_access", "world_event", "api_request"])
      await db.postgres.query(
        `UPDATE ${table} SET subject_id=$2 WHERE subject_id=$1`,
        [user, legacy],
      );
    await context.addCookies([
      {
        name: "gestaloka",
        value: token,
        url: baseURL!,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    await page.goto("/auth/claim");
    await expect(
      page.getByText("引き継ぐ対象の村", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`アプリID: ${user}`, { exact: true }),
    ).toBeVisible();
    expect(
      (
        await db.postgres.query(
          "SELECT user_id FROM world_subject WHERE id=$1",
          [legacy],
        )
      ).rows[0].user_id,
    ).toBeNull();
    await page.screenshot({
      path: "artifacts/screenshots/legacy-claim-preview.png",
      fullPage: true,
    });
    await page
      .getByRole("button", {
        name: "全1件の世界をこのユーザーへ引き継ぐ",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("引き継ぎ済みです。", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await db.postgres.query(
          "SELECT user_id FROM world_subject WHERE id=$1",
          [legacy],
        )
      ).rows[0].user_id,
    ).toBe(user);
    await page.goto(`/worlds/${world}/play`);
    await expect(
      page.getByRole("heading", { name: "セッションを始める", exact: true }),
    ).toBeVisible();
    expect(
      (await (await page.request.get(`/api/worlds/${world}/play`)).json())
        .viewerId,
    ).toBe(actor);
  } finally {
    await db.close();
  }
});
test("構築・追加進行・完了・別村民の行動を実APIと独立ワーカーで再開する", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4174/");
  await page
    .getByLabel("世界の初期設定")
    .fill("一つの村と村民のための初期設定");
  await page
    .getByLabel("この世界の予算上限（USD）", { exact: true })
    .fill("100");
  await page
    .getByRole("button", { name: "初期世界を生成する", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "試遊を進める", exact: true }),
  ).toBeVisible();
  await page.getByLabel("予算上限（USD）", { exact: true }).fill("120");
  await page
    .getByRole("button", { name: "予算上限を保存する", exact: true })
    .click();
  await expect(
    page.getByText(
      "予算上限を保存しました。保留した処理は保存状態から再開できます。",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("heading", { name: "この世界の予算", exact: true })
    .locator("..")
    .screenshot({ path: "artifacts/screenshots/world-budget.png" });
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
  await participate(page);

  await page
    .getByRole("button", { name: "セッションを開始", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "1人のセッション" }),
  ).toBeVisible();
  await page.getByLabel("発言・ターンコメント").fill("周囲の音に耳を澄ませる");
  await page.getByRole("button", { name: "発言する", exact: true }).click();
  await page.getByRole("button", { name: "手番を終える", exact: true }).click();
  await expect(page.getByLabel("セッションのチャット")).toContainText(
    "周囲の音に耳を澄ませる",
  );
  await page
    .getByRole("button", { name: "本人のシーンを終了", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "本人のシーンを終了しました" }),
  ).toBeVisible();
});

test("狭い画面で入力・閲覧・テーマ切替ができる", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("http://127.0.0.1:4174/");
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

test("管理画面で設定を保存し、一般ユーザーには参加画面だけを提供する", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4174/");
  const title = `狩人-${randomUUID()}`;
  await page.getByLabel("設定の名称", { exact: true }).fill(title);
  await page.getByLabel("参加者向けの説明", { exact: true }).fill("森を歩く人");
  await page
    .getByLabel("生成用の設定本文（管理者向け）", { exact: true })
    .fill("PRIVATE_PRESET_森での生活に即した人物");
  await page
    .getByRole("button", { name: "プレイヤー設定を保存する", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/screenshots/admin-presets.png",
    fullPage: true,
  });
  const id = (await (await page.request.get("/api/session")).json()).id;
  const db = connectDatabases();
  try {
    await db.postgres.query("UPDATE app_user SET role='user' WHERE id=$1", [
      id,
    ]);
  } finally {
    await db.close();
  }
  await page.reload();
  await expect(
    page.getByText("管理者の権限が必要です。", { exact: true }),
  ).toBeVisible();
  await page.goto("http://127.0.0.1:4173/");
  await expect(
    page.getByRole("heading", { name: "参加する世界を選ぶ", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "管理画面", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("世界の初期設定", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator("body")).not.toContainText("PRIVATE_PRESET");
  await page.screenshot({
    path: "artifacts/screenshots/user-catalog.png",
    fullPage: true,
  });
});
test("進行中シーンと行動履歴もスクロールで取得し、保持ページの入替えで閲覧位置を保つ", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4174/");
  await page.getByLabel("世界の初期設定").fill("長いシーンの検証用の世界");
  await page
    .getByLabel("この世界の予算上限（USD）", { exact: true })
    .fill("100");
  await page
    .getByRole("button", { name: "初期世界を生成する", exact: true })
    .click();
  await page
    .getByRole("button", { name: "世界構築を完了する", exact: true })
    .click();
  await participate(page);

  const id = new URL(page.url()).pathname.split("/")[2]!;
  const status = await (
    await page.request.get(`/api/worlds/${id}/session`)
  ).json();
  const scene = { id: randomUUID(), viewerId: status.viewerId };
  const events = Array.from({ length: 260 }, (_, i) => ({
    id: randomUUID(),
    actorId: scene.viewerId,
    text: "管理用の出来事",
    period: { from: i, until: i },
    receipts: [
      {
        observerId: scene.viewerId,
        text: `記録${i}。${"広場を通る人の声が聞こえ、村の様子が目に入る。".repeat(8)}`,
      },
    ],
  }));
  const actions = Array.from({ length: 260 }, (_, i) => ({
    id: randomUUID(),
    text: `入力${i}。辺りの様子を確かめる。`,
    state: "complete",
  }));
  const db = connectDatabases();
  try {
    const world = (
      await db.postgres.query(
        "SELECT world_id FROM world_construction WHERE id=$1",
        [id],
      )
    ).rows[0].world_id;
    const data = {
      worldId: world,
      commandId: randomUUID(),
      at: 259,
      startedAt: 0,
      actions,
      events,
      choices: [],
      background: {
        type: "background",
        synopsis: "保存した場面",
        participants: [scene.viewerId],
        facts: [],
        creations: [],
        beliefs: [],
        perceptions: [],
        unknowns: [],
      },
    };
    await db.postgres.query(
      "INSERT INTO world_scene(id,construction_id,actor_id,state,data) VALUES($1,$2,$3,'result',$4)",
      [scene.id, id, scene.viewerId, data],
    );
    await db.postgres.query(
      "INSERT INTO world_scene_session(id,actor_id,world_id,current_id,closed,result,event_count,action_count) VALUES($1,$2,$3,$1,true,$4,260,260)",
      [scene.id, scene.viewerId, id, { text: "保存した結果" }],
    );
    for (const [kind, items] of [
      ["events", events],
      ["actions", actions],
    ] as const)
      for (const [position, payload] of items.entries())
        await db.postgres.query(
          "INSERT INTO world_scene_record(session_id,actor_id,kind,id,scene_id,position,payload) VALUES($1,$2,$3,$4,$1,$5,$6)",
          [scene.id, scene.viewerId, kind, payload.id, position, payload],
        );
  } finally {
    await db.close();
  }
  await page.goto(
    `/worlds/${id}/play?actorId=${scene.viewerId}&sceneId=${scene.id}`,
  );
  await expect(page.getByRole("link", { name: /開始$/ })).toHaveAttribute(
    "href",
    new RegExp(`sceneId=${scene.id}`),
  );
  const section = page.getByRole("region", { name: "このシーン", exact: true }),
    scroll = section.getByLabel("記録の閲覧領域");
  await expect(section).toHaveAttribute("data-retained-records", "50");
  for (let i = 0; i < 4; i++) {
    // Measurements and background refetches can move the bottom while scrolling.
    // Wait for this page's actual response before advancing to the next one.
    let fetched = false;
    const onResponse = (r: import("@playwright/test").Response) => {
      const url = new URL(r.url());
      if (
        r.ok() &&
        url.pathname.endsWith("/scene/records") &&
        url.searchParams.get("kind") === "events" &&
        url.searchParams.has("before")
      )
        fetched = true;
    };
    page.on("response", onResponse);
    try {
      await expect
        .poll(async () => {
          if (
            !fetched &&
            (await scroll.getAttribute("aria-busy")) === "false"
          ) {
            await scroll.evaluate(async (e) => {
              e.scrollTop = Math.max(0, e.scrollHeight - e.clientHeight - 200);
              await new Promise(requestAnimationFrame);
              e.scrollTop = e.scrollHeight;
            });
          }
          return fetched;
        })
        .toBe(true);
    } finally {
      page.off("response", onResponse);
    }
    await expect(scroll).toHaveAttribute("aria-busy", "false");
    await expect(section).toHaveAttribute(
      "data-retained-records",
      String(Math.min(200, (i + 2) * 50)),
    );
    await scroll.evaluate(async (element) => {
      let previous = "",
        stable = 0;
      while (stable < 3) {
        await new Promise(requestAnimationFrame);
        const state =
          `${element.scrollTop}:${element.scrollHeight}:` +
          [...element.querySelectorAll("article")]
            .map((row) => row.getBoundingClientRect().top)
            .join(",");
        stable = state === previous ? stable + 1 : 0;
        previous = state;
      }
    });
    expect(await section.locator("article").count()).toBeLessThan(20);
  }
  await scroll.evaluate(async (e) => {
    e.scrollTop = e.scrollHeight / 2;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  const anchor = await scroll.evaluate((e) => {
    const top = e.getBoundingClientRect().top,
      row = [...e.querySelectorAll<HTMLElement>("article")].find(
        (n) => n.getBoundingClientRect().bottom > top + 8,
      )!;
    return {
      id: row.dataset.recordId!,
      offset: row.getBoundingClientRect().top - top,
    };
  });
  await section
    .getByRole("button", { name: "古い記録を読む", exact: true })
    .click();
  await expect(scroll).toHaveAttribute("aria-busy", "false");
  await expect
    .poll(() =>
      scroll.evaluate((e, saved) => {
        const row = e.querySelector(`[data-record-id="${saved.id}"]`);
        return row
          ? Math.abs(
              row.getBoundingClientRect().top -
                e.getBoundingClientRect().top -
                saved.offset,
            )
          : Infinity;
      }, anchor),
    )
    .toBeLessThan(5);
  expect(
    Number(await section.getAttribute("data-retained-records")),
  ).toBeLessThanOrEqual(200);
  const inputs = page.getByRole("region", {
    name: "入力した行動",
    exact: true,
  });
  await expect(inputs).toHaveAttribute("data-retained-records", "50");
  expect(await inputs.locator("article").count()).toBeLessThan(20);
  await page.screenshot({
    path: "artifacts/screenshots/scene-history-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole("button", { name: "発言する" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "現在のセッションを開く", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/screenshots/scene-history-mobile.png",
    fullPage: true,
  });
});
test("長い履歴の保持と描画を制限し、ページ破棄でも閲覧位置を保つ", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4174/");
  await page.getByLabel("世界の初期設定").fill("履歴の検証用の世界");
  await page
    .getByLabel("この世界の予算上限（USD）", { exact: true })
    .fill("100");
  await page
    .getByRole("button", { name: "初期世界を生成する", exact: true })
    .click();
  await page.getByLabel("さらに進める日数", { exact: true }).fill("1");
  await page.getByRole("button", { name: "試遊を進める", exact: true }).click();
  await page
    .getByRole("button", { name: "世界構築を完了する", exact: true })
    .click();
  await participate(page);

  await page.getByRole("tab", { name: "過去の履歴", exact: true }).click();
  await page.getByText("本人のこれまでの履歴", { exact: true }).click();
  const section = page.getByRole("region", { name: "あなたの記録" }),
    scroll = page.getByLabel("記録の閲覧領域");
  async function settled() {
    await scroll.evaluate(async (element) => {
      let previous = "",
        stable = 0;
      while (stable < 3) {
        await new Promise(requestAnimationFrame);
        const state =
          `${element.scrollTop}:${element.scrollHeight}:` +
          [...element.querySelectorAll<HTMLElement>("article")]
            .map(
              (row) =>
                `${row.dataset.recordId}:${row.getBoundingClientRect().top}`,
            )
            .join("|");
        stable = state === previous ? stable + 1 : 0;
        previous = state;
      }
    });
  }
  async function older() {
    const loaded = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith("/knowledge") && url.searchParams.has("before")
      );
    });
    await page
      .getByRole("button", { name: "古い記録を読む", exact: true })
      .click();
    await loaded;
    await expect(scroll).toHaveAttribute("aria-busy", "false");
    await settled();
  }
  await expect
    .poll(() => section.getAttribute("data-retained-records"))
    .toBe("50");
  for (let index = 0; index < 4; index++) {
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await older();
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
  await settled();
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
  await older();
  await expect(
    page.getByText("記録を確認しています", { exact: true }),
  ).toBeHidden();
  await expect
    .poll(() =>
      scroll.evaluate((container, saved) => {
        const row = container.querySelector(`[data-record-id="${saved.id}"]`);
        return row
          ? Math.abs(
              row.getBoundingClientRect().top -
                container.getBoundingClientRect().top -
                saved.offset,
            )
          : Infinity;
      }, anchor),
    )
    .toBeLessThan(5);
  expect(
    Number(await section.getAttribute("data-retained-records")),
  ).toBeLessThanOrEqual(200);
  await page.getByRole("button", { name: "最新へ", exact: true }).click();
  await expect(
    page.getByText("あなたが初めて知覚した景色", { exact: true }),
  ).toBeVisible();
});
