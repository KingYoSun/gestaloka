import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  setupStories,
  Stories,
} from "../../packages/server/src/http/stories.js";
import { isolatedDatabases } from "../support/isolated-db.js";

test("作品一覧は続話の公開や既刊の話・作品の編集で並び替わる", async () => {
  const isolated = isolatedDatabases();
  await isolated.setup();
  try {
    const db = isolated.databases.postgres;
    const stories = new Stories(db);
    const older = randomUUID();
    const newer = randomUUID();
    const world = randomUUID();
    const user = randomUUID();
    const actor = randomUUID();
    await setupStories(db);
    await db.query(`ALTER TABLE player_story DROP COLUMN updated_at;
      CREATE TABLE world_access(construction_id uuid,subject_id uuid,role text,actor_id uuid);
      CREATE TABLE world_subject(id uuid,user_id uuid,active boolean);`);
    await db.query("INSERT INTO world_subject VALUES($1,$1,true)", [user]);
    await db.query("INSERT INTO world_access VALUES($1,$2,'player',$3)", [
      world,
      user,
      actor,
    ]);
    await db.query(
      `INSERT INTO player_story(id,world_id,world_title,author_id,author,title,published_at) VALUES
        ($1,$3,'村',$4,'船主','初航海','2026-01-01T00:00:00Z'),
        ($2,$3,'村',$4,'船主','帰港','2026-01-02T00:00:00Z')`,
      [older, newer, world, user],
    );
    await db.query(
      `INSERT INTO player_story_episode(story_id,number,request_id,body,published_at) VALUES
        ($1,1,$1,'帆を揚げた。','2026-01-01T00:00:00Z'),
        ($2,1,$2,'岸に着いた。','2026-01-02T00:00:00Z'),
        ($1,2,$3,'岸を離れた。','2026-01-03T00:00:00Z')`,
      [older, newer, randomUUID()],
    );
    await setupStories(db);
    const order = async (query: Parameters<Stories["list"]>[1] = {}) =>
      (await stories.list(user, { worldId: world, ...query })).items.map(
        ({ id }) => id,
      );
    expect(await order()).toEqual([older, newer]);
    expect(await order({ before: older })).toEqual([newer]);
    expect(await order({ sort: "newest" })).toEqual([newer, older]);

    const continuation = {
      requestId: randomUUID(),
      storyId: newer,
      body: "綱を結んだ。",
    };
    expect(await stories.post(user, world, continuation)).toMatchObject({
      episode: 2,
    });
    expect(await order()).toEqual([newer, older]);

    const edit = {
      operation: "edit" as const,
      requestId: randomUUID(),
      storyId: older,
      episode: 1,
      body: "朝の風で帆を揚げた。",
    };
    expect(await stories.post(user, world, edit)).toMatchObject({ episode: 1 });
    expect(await order({ sort: "updated" })).toEqual([older, newer]);
    expect(await stories.post(user, world, continuation)).toMatchObject({
      episode: 2,
    });
    expect(await order()).toEqual([older, newer]);
    expect(await order({ until: "2026-01-01" })).toEqual([older]);

    await stories.post(user, world, {
      operation: "edit",
      requestId: randomUUID(),
      storyId: newer,
      title: "潮の引いた港",
    });
    expect(await order()).toEqual([newer, older]);
  } finally {
    await isolated.close();
  }
});

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
    await db.query("INSERT INTO world_subject VALUES($1,$1,true)", [user]);
    await db.query("INSERT INTO world_access VALUES($1,$2,'player',$3)", [
      world,
      user,
      randomUUID(),
    ]);
    expect(await stories.read(user, storyId, { episode: "2" })).toMatchObject({
      story: { title: "初航海の記録" },
      episode: { body: "港を出た。" },
    });
    await stories.bookmark(user, storyId, true);
    await db.query("UPDATE world_subject SET active=false WHERE id=$1", [user]);
    expect(await stories.list(user, { bookmarked: "1" })).toEqual({
      items: [],
      next: null,
    });
    await expect(
      stories.read(user, storyId, { image: "1" }),
    ).rejects.toMatchObject({ code: "STORY_NOT_FOUND" });
  } finally {
    await isolated.close();
  }
});

test("投稿状況は期間内に公開された公開中の話から数え、編集や著者名の変更で増やさない", async () => {
  const isolated = isolatedDatabases();
  await isolated.setup();
  try {
    const db = isolated.databases.postgres;
    const stories = new Stories(db);
    const id = () => randomUUID() as string;
    const [world, other, first, second, outsider] = [
      id(),
      id(),
      id(),
      id(),
      id(),
    ];
    const [serial, started, joined, removed, elsewhere] = [
      id(),
      id(),
      id(),
      id(),
      id(),
    ];
    await setupStories(db);
    await db.query(`CREATE TABLE world_access(construction_id uuid,subject_id uuid,role text,actor_id uuid);
      CREATE TABLE world_subject(id uuid,user_id uuid,active boolean);`);
    for (const user of [first, second, outsider])
      await db.query("INSERT INTO world_subject VALUES($1,$1,true)", [user]);
    for (const [construction, user] of [
      [world, first],
      [world, second],
      [other, first],
      [other, outsider],
    ])
      await db.query("INSERT INTO world_access VALUES($1,$2,'player',$3)", [
        construction,
        user,
        randomUUID(),
      ]);
    await db.query(
      `INSERT INTO player_story(id,world_id,world_title,author_id,author,title,published_at) VALUES
        ($1,$6,'村',$8,'船主','初航海','2026-01-10T00:00:00Z'),
        ($2,$6,'村',$8,'別名','港の朝','2026-01-31T15:30:00Z'),
        ($3,$6,'村',$9,'漁師','網','2026-02-10T00:00:00Z'),
        ($4,$6,'村',$9,'漁師','消した話','2026-02-11T00:00:00Z'),
        ($5,$7,'町',$8,'船主','町の話','2026-02-12T00:00:00Z')`,
      [
        serial,
        started,
        joined,
        removed,
        elsewhere,
        world,
        other,
        first,
        second,
      ],
    );
    await db.query(
      `INSERT INTO player_story_episode(story_id,number,request_id,body,published_at) VALUES
        ($1,1,$1,'帆を揚げた。','2026-01-10T00:00:00Z'),
        ($1,2,$6,'岸を離れた。','2026-02-05T00:00:00Z'),
        ($1,3,$7,'嵐が来た。','2026-02-28T15:00:00Z'),
        ($2,1,$2,'朝が来た。','2026-01-31T15:30:00Z'),
        ($3,1,$3,'網を張った。','2026-02-10T00:00:00Z'),
        ($4,1,$4,'消える。','2026-02-11T00:00:00Z'),
        ($5,1,$5,'町に着いた。','2026-02-12T00:00:00Z')`,
      [serial, started, joined, removed, elsewhere, randomUUID(), randomUUID()],
    );
    await stories.post(second, world, {
      operation: "delete",
      requestId: randomUUID(),
      storyId: removed,
    });
    const february = {
      worldId: world,
      since: "2026-02-01",
      until: "2026-02-28",
    };
    const counts = {
      stories: 2,
      episodes: 3,
      firstEpisodes: 2,
      continuedEpisodes: 1,
      players: 2,
    };
    expect(await stories.stats(first, february)).toMatchObject(counts);
    for (const change of [
      { episode: 1, body: "朝の風で帆を揚げた。" },
      { author: "老船主" },
    ])
      await stories.post(first, world, {
        operation: "edit",
        requestId: randomUUID(),
        storyId: serial,
        ...change,
      });
    expect(await stories.stats(first, february)).toEqual({
      ...february,
      ...counts,
    });
    expect(await stories.stats(first, { worldId: world })).toMatchObject({
      stories: 3,
      episodes: 5,
      players: 2,
    });
    expect(await stories.stats(outsider, february)).toMatchObject({
      stories: 0,
      episodes: 0,
      players: 0,
    });
  } finally {
    await isolated.close();
  }
});
