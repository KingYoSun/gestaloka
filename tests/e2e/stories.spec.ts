import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { connectDatabases } from "@gestaloka/server";
import sharp from "sharp";
import { fixtureAuth } from "../support/auth.js";
import { test, expect } from "./fixtures.js";

test("STORIES を一行から公開し、同じ世界にプレイヤーを持つアカウントが連載を読める", async ({
  page,
  browser,
  baseURL,
}) => {
  const db = connectDatabases();
  const directory = await mkdtemp(join(tmpdir(), "gestaloka-stories-"));
  const readerContext = await browser.newContext({ baseURL: baseURL! });
  const headers = { "X-Gestaloka-Request": "1" };
  try {
    const create = async (prompt: string) => {
      const response = await page.request.post("/api/worlds", {
        headers,
        data: { requestId: randomUUID(), prompt, budgetUsd: 20 },
      });
      expect(response.ok(), await response.text()).toBe(true);
      const { id } = await response.json();
      await expect
        .poll(
          async () =>
            (await (await page.request.get(`/api/worlds/${id}`)).json()).state,
        )
        .toBe("ready");
      const finish = await page.request.post(`/api/worlds/${id}/commands`, {
        headers,
        data: { requestId: randomUUID(), command: "finish" },
      });
      expect(finish.ok(), await finish.text()).toBe(true);
      return id as string;
    };
    const world = await create("渡し場のある村");
    const otherWorld = await create("山のある村");
    const author = (await (await page.request.get("/api/session")).json()).id;
    const auth = await fixtureAuth(db.postgres);
    const reader = await auth.person("user");
    await db.postgres.query("INSERT INTO e2e_subject(scope,id) VALUES($1,$2)", [
      process.env.E2E_SCOPE,
      reader.id,
    ]);
    await db.postgres.query(
      "INSERT INTO world_subject(id,user_id) VALUES($1,$1)",
      [reader.id],
    );
    await readerContext.addCookies([
      { name: "test_ory", value: reader.id, url: baseURL!, httpOnly: true },
    ]);
    const grant = (user: string, id: string) =>
      db.postgres.query(
        `INSERT INTO world_access(subject_id,construction_id,role,actor_id)
       SELECT $1,id,'player',actor_id FROM world_construction WHERE id=$2`,
        [user, id],
      );
    await grant(author, world);
    await grant(author, otherWorld);
    await db.postgres.query(
      "UPDATE world_construction SET public_title=CASE WHEN id=$1 THEN '川の村' ELSE '山の村' END WHERE id IN ($1,$2)",
      [world, otherWorld],
    );
    await grant(reader.id, otherWorld);

    const {
      rows: [{ world_id: graphId }],
    } = await db.postgres.query(
      "SELECT world_id FROM world_construction WHERE id=$1",
      [world],
    );
    const snapshot = async () => ({
      graph: (
        await db.graph.executeQuery(
          `MATCH (n:WorldNode {worldId:$id}) RETURN properties(n) AS data, 'node' AS kind
         UNION ALL MATCH (:WorldNode {worldId:$id})-[r]->(:WorldNode {worldId:$id})
         RETURN properties(r) AS data, type(r) AS kind`,
          { id: graphId },
        )
      ).records
        .map((row) => JSON.stringify(row.toObject()))
        .sort(),
      history: (
        await db.postgres.query(
          `SELECT (SELECT count(*) FROM bot_scene WHERE world_id=$1) AS bot,
                (SELECT count(*) FROM bot_request WHERE world_id=$1) AS requests,
                (SELECT count(*) FROM world_scene_session WHERE world_id=$1) AS scenes`,
          [world],
        )
      ).rows,
    });
    const before = await snapshot();
    const cover = join(directory, "舟.png");
    await sharp({
      create: { width: 64, height: 32, channels: 3, background: "skyblue" },
    })
      .png()
      .toFile(cover);
    await page.goto("/stories");
    await page.getByRole("link", { name: "物語を書く", exact: true }).click();
    const destination = page.getByRole("combobox", {
      name: "世界",
      exact: true,
    });
    await expect(destination).toHaveValue("");
    await page.goto(`/worlds/${otherWorld}`);
    await page.getByRole("link", { name: "この世界の STORIES" }).click();
    await page.getByRole("link", { name: "この世界の物語を書く" }).click();
    await expect(
      page.getByRole("heading", { name: "物語を書く", exact: true }),
    ).toBeVisible();
    await expect(destination).toHaveValue(otherWorld);
    await destination.selectOption({ label: "川の村" });
    await page.getByLabel("作品名", { exact: true }).fill("初航海");
    await page.getByLabel("著者名").fill("船主");
    await page.getByLabel("本文").fill("あの冗談でようやく綱を解けた。");
    await page.getByLabel("添付画像（任意）").setInputFiles(cover);
    await page.getByRole("button", { name: "公開する" }).click();
    await expect(page.getByRole("heading", { name: "初航海" })).toBeVisible();
    await expect(
      page.getByText("あの冗談でようやく綱を解けた。"),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "第1話の添付画像" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "次の話", exact: true }),
    ).toHaveCount(0);
    const storyId = new URL(page.url()).pathname.split("/").at(-1)!;
    await expect(destination).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "川の村", exact: true }),
    ).toHaveAttribute("href", new RegExp(world));

    await page.getByLabel("本文").fill("翌朝、船大工にも帆を任せてみた。");
    await page.getByRole("button", { name: "公開する" }).click();
    await expect(page.getByRole("heading", { name: "第2話" })).toBeVisible();
    await expect(page.locator(".story-image")).toHaveCount(0);
    const path = `/api/worlds/${world}/stories`;
    const blocked = await readerContext.request.post(path, {
      headers,
      data: { requestId: randomUUID(), storyId, body: "続話の上書き" },
    });
    expect(blocked.status()).toBe(403);

    const connectCli = async (worldId: string) => {
      const deviceId = randomUUID(),
        secret = randomBytes(32).toString("hex");
      await db.postgres.query(
        `INSERT INTO player_device(id,world_id,token_hash,user_code,user_id,actor_id)
       SELECT $1,id,$3,$1::uuid::text,$4,actor_id FROM world_construction WHERE id=$2`,
        [
          deviceId,
          worldId,
          createHash("sha256").update(secret).digest("hex"),
          reader.id,
        ],
      );
      const profile = join(directory, `${worldId}.json`);
      await writeFile(
        profile,
        JSON.stringify({ server: baseURL, worldId, deviceId, secret }),
      );
      return async (...args: string[]) => {
        const result = await promisify(execFile)(process.execPath, [
          resolve("packages/player-cli/dist/main.js"),
          "--profile",
          profile,
          "--full-ids",
          ...args,
        ]).catch((error: { stdout?: string }) => {
          if (!error.stdout) throw error;
          return { stdout: error.stdout };
        });
        return JSON.parse(result.stdout);
      };
    };
    const cli = await connectCli(otherWorld);

    const visitor = await readerContext.newPage();
    await visitor.goto("/stories");
    const filter = visitor.getByRole("combobox", { name: "世界", exact: true });
    await expect(filter.locator("option")).toHaveCount(2);
    await expect(
      visitor.getByText("条件に合う作品はありません。"),
    ).toBeVisible();
    await visitor.goto(`/stories/${storyId}`);
    await expect(
      visitor.getByText("作品または指定した話が見つかりません"),
    ).toBeVisible();
    expect((await cli("stories", "list", "--world", world)).items).toEqual([]);
    expect(await cli("stories", "read", "--story", storyId)).toMatchObject({
      code: "STORY_NOT_FOUND",
    });
    expect(await cli("stories", "bookmark", "--story", storyId)).toMatchObject({
      code: "STORY_NOT_FOUND",
    });
    await grant(reader.id, world);
    await visitor.goto("/stories");
    await filter.selectOption(otherWorld);
    await visitor.getByRole("button", { name: "一覧に適用" }).click();
    await expect(visitor).toHaveURL(new RegExp(otherWorld));
    await expect(
      visitor.getByText("条件に合う作品はありません。"),
    ).toBeVisible();
    await filter.selectOption(world);
    await visitor.getByRole("button", { name: "一覧に適用" }).click();
    await expect(
      visitor.getByRole("link", { name: "初航海", exact: true }),
    ).toBeVisible();
    await filter.selectOption("");
    await visitor.getByRole("button", { name: "一覧に適用" }).click();
    await expect(visitor).not.toHaveURL(/worldId=/);
    await visitor.getByRole("link", { name: "初航海", exact: true }).click();
    await visitor.getByRole("link", { name: "次の話", exact: true }).click();
    await expect(visitor.getByRole("heading", { name: "第2話" })).toBeVisible();
    const list = await cli(
      "stories",
      "list",
      "--world",
      world,
      "--author",
      "船主",
    );
    expect(list.items.map((story: { id: string }) => story.id)).toEqual([
      storyId,
    ]);
    const selected = await cli(
      "stories",
      "read",
      "--story",
      storyId,
      "--episode",
      "2",
    );
    expect(
      selected.episodes.map((episode: { number: number }) => episode.number),
    ).toEqual([1, 2]);
    await expect(visitor.locator(".story-body")).toHaveText(
      selected.episode.body,
    );
    const webTimestamp = await visitor
      .locator("article time")
      .getAttribute("datetime");
    // CLI は現地時刻を秒単位で表示する。
    expect(Math.floor(Date.parse(webTimestamp!) / 1000)).toBe(
      Date.parse(selected.episode.publishedAt) / 1000,
    );
    await expect(
      visitor.getByRole("link", {
        name: `${selected.story.author}のプレイヤーの作品`,
        exact: true,
      }),
    ).toBeVisible();

    const payload = {
      requestId: randomUUID(),
      storyId,
      body: "帆を補修した。",
    };
    const replay = await Promise.all(
      [1, 2].map(() => page.request.post(path, { headers, data: payload })),
    );
    for (const response of replay) {
      expect(response.ok(), await response.text()).toBe(true);
      expect(await response.json()).toEqual({ storyId, episode: 3 });
    }
    const writer = await connectCli(world);
    expect(
      await writer(
        "stories",
        "post",
        "--story",
        storyId,
        "--text",
        "他の人の続きを書く。",
      ),
    ).toMatchObject({ state: "error", code: "STORY_WRITE_FORBIDDEN" });
    const first = await writer(
      "stories",
      "post",
      "--title",
      "出帆",
      "--author",
      "船大工",
      "--text",
      "船主の手が震えていた。",
    );
    expect(first.result).toMatchObject({
      storyId: expect.any(String),
      episode: 1,
    });
    const nextBody = "帆を任された。\n初めて舵を取った。";
    const file = join(directory, "続話.txt");
    await writeFile(file, nextBody, "utf8");
    const next = await writer(
      "stories",
      "post",
      "--story",
      first.result.storyId,
      "--file",
      file,
      "--image",
      cover,
    );
    expect(next.result).toEqual({ storyId: first.result.storyId, episode: 2 });
    expect(await writer("recover", "--request", next.requestId)).toEqual(next);
    const works = await cli("stories", "list", "--world", world);
    expect(
      works.items.map((story: { author: string }) => story.author),
    ).toEqual(["船大工", "船主"]);
    const published = await cli(
      "stories",
      "read",
      "--story",
      first.result.storyId,
    );
    expect(published.episode.body).toBe("船主の手が震えていた。");
    expect(
      published.episodes.map((episode: { number: number }) => episode.number),
    ).toEqual([1, 2]);
    await page.goto(`/stories/${first.result.storyId}?episode=2`);
    await expect(page.locator(".story-body")).toHaveText(nextBody);
    await expect(
      page.getByRole("img", { name: "第2話の添付画像" }),
    ).toBeVisible();
    const downloaded = join(directory, "舟.webp");
    const downloadedStory = await cli(
      "stories",
      "read",
      "--story",
      first.result.storyId,
      "--episode",
      "2",
      "--image",
      downloaded,
    );
    expect(downloadedStory.episode.hasImage).toBe(true);
    expect(downloadedStory.episode.image).toBeUndefined();
    expect(await sharp(await readFile(downloaded)).metadata()).toMatchObject({
      format: "webp",
      width: 64,
      height: 32,
    });
    await db.postgres.query(
      "UPDATE player_story SET published_at=CASE WHEN id=$1 THEN '2026-01-02T14:59:59Z'::timestamptz ELSE '2026-01-02T15:00:00Z'::timestamptz END WHERE id IN ($1,$2)",
      [storyId, first.result.storyId],
    );
    await db.postgres.query(
      "UPDATE player_story_episode SET published_at=CASE WHEN number=1 THEN '2026-01-02T14:59:59Z'::timestamptz ELSE '2026-01-02T15:00:00Z'::timestamptz END WHERE story_id=$1",
      [first.result.storyId],
    );
    const filtered = await cli(
      "stories",
      "list",
      "--player",
      published.story.player,
      "--title",
      "出帆",
      "--since",
      "2026-01-03",
      "--until",
      "2026-01-03",
      "--sort",
      "title",
    );
    expect(filtered.items.map((item: { id: string }) => item.id)).toEqual([
      first.result.storyId,
    ]);
    const sorted = await cli(
      "stories",
      "list",
      "--world",
      world,
      "--sort",
      "oldest",
    );
    expect(sorted.items.map((item: { id: string }) => item.id)).toEqual([
      storyId,
      first.result.storyId,
    ]);
    const toc = await cli(
      "stories",
      "read",
      "--story",
      first.result.storyId,
      "--since",
      "2026-01-03",
      "--sort",
      "newest",
    );
    expect(
      toc.episodes.map((entry: { number: number }) => entry.number),
    ).toEqual([2]);

    await page.getByLabel("目次の並び順").selectOption("newest");
    await page
      .getByRole("form", { name: "目次の絞り込み" })
      .getByRole("button", { name: "一覧に適用" })
      .click();
    await expect(page.locator("section li a")).toHaveText(["第2話", "第1話"]);
    await page
      .getByRole("link", { name: "船大工のプレイヤーの作品", exact: true })
      .click();
    await page.getByLabel("作品名", { exact: true }).fill("出帆");
    await page.getByLabel("開始日").fill("2026-01-03");
    await page.getByLabel("終了日").fill("2026-01-03");
    await page.getByLabel("作品の並び順").selectOption("title");
    await page.getByRole("button", { name: "一覧に適用" }).click();
    await expect(
      page.getByRole("region", { name: "作品一覧" }).getByRole("heading"),
    ).toHaveText(["出帆"]);
    await expect(page).toHaveURL(/since=2026-01-03/);
    const guide = await page.request.get("/api/player-cli/stories.md");
    expect(guide.ok()).toBe(true);
    expect(await guide.text()).toContain("stories post --story");
    expect(await guide.text()).toContain("stories edit --story");

    await page.goto(`/stories/${storyId}`);
    await expect(
      page.locator("article .story-image + .story-body"),
    ).toBeVisible();
    const firstPublishedAt = await page
      .locator("article time")
      .getAttribute("datetime");
    await page.getByRole("button", { name: "作品・第1話を編集" }).click();
    await page.getByLabel("作品名", { exact: true }).fill("初航海の記録");
    await page.getByLabel("著者名", { exact: true }).fill("若い船主");
    await page.getByLabel("各話のタイトル（任意）").fill("出航の日");
    await page
      .getByRole("textbox", { name: "本文", exact: true })
      .fill("冗談を聞いて、綱を解いた。");
    await page.getByLabel("添付画像を削除", { exact: true }).check();
    await page.getByRole("button", { name: "修正を保存" }).click();
    await expect(
      page.getByRole("heading", { name: "初航海の記録", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".story-body")).toHaveText(
      "冗談を聞いて、綱を解いた。",
    );
    await expect(page.locator("article h2")).toContainText("出航の日");
    await expect(page.locator("section li a").first()).toContainText(
      "出航の日",
    );
    await expect(page.locator(".story-image")).toHaveCount(0);
    await expect(page.locator("article time")).toHaveAttribute(
      "datetime",
      firstPublishedAt!,
    );
    await page.goto(`/stories?worldId=${world}`);
    await expect(page.getByLabel("作品の並び順")).toHaveValue("updated");
    const worksRegion = page.getByRole("region", { name: "作品一覧" });
    await expect(worksRegion.getByRole("heading")).toHaveText([
      "初航海の記録",
      "出帆",
    ]);
    const dates = worksRegion
      .getByRole("article")
      .first()
      .getByText(/公開日.*更新日/);
    await expect(dates).toBeVisible();
    const {
      rows: [editedStory],
    } = await db.postgres.query<{ updated_at: Date }>(
      "SELECT updated_at FROM player_story WHERE id=$1",
      [storyId],
    );
    await expect(dates.locator("time")).toHaveCount(2);
    await expect(dates.locator("time").first()).toHaveAttribute(
      "datetime",
      "2026-01-02T14:59:59.000Z",
    );
    await expect(dates.locator("time").last()).toHaveAttribute(
      "datetime",
      editedStory!.updated_at.toISOString(),
    );
    await page.goto(`/stories/${storyId}`);
    expect(
      await writer(
        "stories",
        "edit",
        "--story",
        storyId,
        "--title",
        "別人による変更",
      ),
    ).toMatchObject({ code: "STORY_WRITE_FORBIDDEN" });
    const revised = await writer(
      "stories",
      "edit",
      "--story",
      first.result.storyId,
      "--episode",
      "2",
      "--text",
      "初めて舵を取った朝。",
      "--episode-title",
      "初めての舵",
      "--clear",
    );
    expect(revised.result).toEqual({
      storyId: first.result.storyId,
      episode: 2,
    });
    expect(await writer("recover", "--request", revised.requestId)).toEqual(
      revised,
    );
    expect(await writer("recover", "--request", next.requestId)).toEqual(next);
    const revisedRead = await cli(
      "stories",
      "read",
      "--story",
      first.result.storyId,
      "--episode",
      "2",
    );
    expect(revisedRead.episode).toMatchObject({
      number: 2,
      title: "初めての舵",
      body: "初めて舵を取った朝。",
      hasImage: false,
    });
    expect(revisedRead.episodes[1]).toEqual({
      ...toc.episodes[0],
      title: "初めての舵",
    });

    await page.getByRole("button", { name: "ブックマークに追加" }).click();
    await expect(
      page.getByRole("button", { name: "ブックマークを解除" }),
    ).toBeVisible();
    expect((await cli("stories", "list", "--bookmarked")).items).toEqual([]);
    expect(await cli("stories", "bookmark", "--story", storyId)).toEqual({
      bookmarked: true,
    });
    await visitor.goto("/stories?bookmarked=1");
    await expect(
      visitor.getByRole("link", { name: "初航海の記録" }),
    ).toBeVisible();
    expect(
      await cli("stories", "bookmark", "--story", storyId, "--clear"),
    ).toEqual({ bookmarked: false });
    expect((await cli("stories", "list", "--bookmarked")).items).toEqual([]);

    const deleted = await writer(
      "stories",
      "delete",
      "--story",
      first.result.storyId,
      "--episode",
      "1",
    );
    expect(deleted.result).toMatchObject({ episode: 1, deleted: "episode" });
    expect(await writer("recover", "--request", deleted.requestId)).toEqual(
      deleted,
    );
    const remaining = await cli(
      "stories",
      "read",
      "--story",
      first.result.storyId,
    );
    expect(remaining.episode.number).toBe(2);
    expect(
      remaining.episodes.map((entry: { number: number }) => entry.number),
    ).toEqual([2]);
    expect(remaining.previousEpisode).toBeNull();
    expect(
      await cli(
        "stories",
        "read",
        "--story",
        first.result.storyId,
        "--episode",
        "1",
      ),
    ).toMatchObject({ code: "STORY_NOT_FOUND" });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "作品を削除", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "STORIES", exact: true }),
    ).toBeVisible();
    expect(await cli("stories", "read", "--story", storyId)).toMatchObject({
      code: "STORY_NOT_FOUND",
    });
    expect(
      (
        await writer(
          "stories",
          "delete",
          "--story",
          first.result.storyId,
          "--episode",
          "2",
        )
      ).result,
    ).toMatchObject({ deleted: "story" });
    expect((await cli("stories", "list", "--world", world)).items).toEqual([]);
    expect(await snapshot()).toEqual(before);
  } finally {
    await readerContext.close();
    await db.close();
    await rm(directory, { recursive: true });
  }
});
