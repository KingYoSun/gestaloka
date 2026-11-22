import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  setupStories,
  Stories,
} from "../../packages/server/src/http/stories.js";
import { isolatedDatabases } from "../support/isolated-db.js";

test("旧版で公開した話の再送は修正の前後で同じ結果を返す", async () => {
  const isolated = isolatedDatabases();
  await isolated.setup();
  try {
    const db = isolated.databases.postgres;
    const stories = new Stories(db);
    const storyId = randomUUID(),
      world = randomUUID(),
      user = randomUUID();
    const first = {
      requestId: storyId,
      title: "初航海",
      author: "船主",
      body: "帆を揚げた。",
    };
    const second = { requestId: randomUUID(), storyId, body: "岸を離れた。" };
    await setupStories(db);
    await db.query("DROP TABLE player_story_request");
    await db.query(
      "INSERT INTO player_story(id,world_id,world_title,author_id,author,title) VALUES($1,$2,'村',$3,$4,$5)",
      [storyId, world, user, first.author, first.title],
    );
    await db.query(
      "INSERT INTO player_story_episode(story_id,number,request_id,body) VALUES($1,1,$1,$2),($1,2,$3,$4)",
      [storyId, first.body, second.requestId, second.body],
    );
    // A first-post replay can reach the old INSERT path without an active grant.
    await db.query(`CREATE TABLE world_construction(id uuid,public_title text);
      CREATE TABLE world_access(construction_id uuid,subject_id uuid,role text,actor_id uuid);
      CREATE TABLE world_subject(id uuid,user_id uuid,active boolean);`);
    await setupStories(db);
    const edit = {
      operation: "edit" as const,
      requestId: randomUUID(),
      storyId,
      episode: 2,
      body: "港を出た。",
      title: "初航海の記録",
    };
    expect(await stories.post(user, world, edit)).toEqual({
      storyId,
      episode: 2,
    });
    expect(await stories.post(user, world, first)).toEqual({
      storyId,
      episode: 1,
    });
    expect(await stories.post(user, world, second)).toEqual({
      storyId,
      episode: 2,
    });
    expect(
      await stories.post(user, world, { ...second, body: "別の本文" }),
    ).toBe("conflict");
    expect(await stories.read(user, storyId, { episode: "2" })).toMatchObject({
      story: { title: "初航海の記録" },
      episode: { body: "港を出た。" },
    });
  } finally {
    await isolated.close();
  }
});
