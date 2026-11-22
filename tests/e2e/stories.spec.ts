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

    const deviceId = randomUUID(),
      secret = randomBytes(32).toString("hex");
    await db.postgres.query(
      `INSERT INTO player_device(id,world_id,token_hash,user_code,user_id,actor_id)
       SELECT $1,id,$3,$1::uuid::text,$4,actor_id FROM world_construction WHERE id=$2`,
      [
        deviceId,
        otherWorld,
        createHash("sha256").update(secret).digest("hex"),
        reader.id,
      ],
    );
    const profile = join(directory, "profile.json");
    await writeFile(
      profile,
      JSON.stringify({
        server: baseURL,
        worldId: otherWorld,
        deviceId,
        secret,
      }),
    );
    const cli = async (...args: string[]) =>
      JSON.parse(
        (
          await promisify(execFile)(process.execPath, [
            resolve("packages/player-cli/dist/main.js"),
            "--profile",
            profile,
            "--full-ids",
            "stories",
            ...args,
          ])
        ).stdout,
      );

    const visitor = await readerContext.newPage();
    await visitor.goto("/stories");
    await visitor.getByRole("link", { name: "初航海", exact: true }).click();
    await visitor.getByRole("link", { name: "次の話", exact: true }).click();
    await expect(visitor.getByRole("heading", { name: "第2話" })).toBeVisible();
    const list = await cli("list", "--world", world, "--author", "船主");
    expect(list.items.map((story: { id: string }) => story.id)).toEqual([
      storyId,
    ]);
    const selected = await cli("read", "--story", storyId, "--episode", "2");
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
    const perspective = await readerContext.request.post(path, {
      headers,
      data: {
        requestId: randomUUID(),
        title: "出帆",
        author: "船大工",
        body: "船主の手が震えていた。",
      },
    });
    expect(perspective.ok(), await perspective.text()).toBe(true);
    const works = await cli("list", "--world", world);
    expect(
      works.items.map((story: { author: string }) => story.author),
    ).toEqual(["船大工", "船主"]);
    expect((await cli("read", "--story", works.items[0].id)).episode.body).toBe(
      "船主の手が震えていた。",
    );
    expect(await snapshot()).toEqual(before);
  } finally {
    await readerContext.close();
    await db.close();
    await rm(directory, { recursive: true });
  }
});
