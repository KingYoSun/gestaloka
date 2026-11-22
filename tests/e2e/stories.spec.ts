import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { connectDatabases } from "@gestaloka/server";
import { fixtureAuth } from "../support/auth.js";
import { test, expect } from "./fixtures.js";

test("STORIES を一行から公開し、別の世界からも連載を読める", async ({
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
    await page.goto(`/worlds/${world}`);
    await page.getByRole("link", { name: "この世界の STORIES" }).click();
    await page.getByRole("link", { name: "この世界の物語を書く" }).click();
    await page.getByLabel("作品名").fill("初航海");
    await page.getByLabel("著者名").fill("船主");
    await page.getByLabel("本文").fill("あの冗談でようやく綱を解けた。");
    await page.getByRole("button", { name: "公開する" }).click();
    await expect(page.getByRole("heading", { name: "初航海" })).toBeVisible();
    await expect(
      page.getByText("あの冗談でようやく綱を解けた。"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "次の話", exact: true }),
    ).toHaveCount(0);
    const storyId = new URL(page.url()).pathname.split("/").at(-1)!;

    await page.getByLabel("本文").fill("翌朝、船大工にも帆を任せてみた。");
    await page.getByRole("button", { name: "公開する" }).click();
    await expect(page.getByRole("heading", { name: "第2話" })).toBeVisible();
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
    const webTimestamp = await visitor.locator("time").getAttribute("datetime");
    // CLI は現地時刻を秒単位で表示する。
    expect(Math.floor(Date.parse(webTimestamp!) / 1000)).toBe(
      Date.parse(selected.episode.publishedAt) / 1000,
    );
    await expect(
      visitor.getByRole("link", { name: selected.story.author, exact: true }),
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
    await grant(reader.id, world);
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
    expect(await snapshot()).toEqual(before);
  } finally {
    await readerContext.close();
    await db.close();
    await rm(directory, { recursive: true });
  }
});
