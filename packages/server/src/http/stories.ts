import type pg from "pg";
import type { z } from "zod";
import { STORY_IMAGE_MAX_BYTES } from "@gestaloka/contracts";
import { staticWebp } from "../runtime/player-icons.js";
import { AccessError } from "./access.js";
import type {
  StoryList,
  StoryEdit,
  StoryDelete,
  StoryListQuery,
  StoryPost,
  StoryRead,
  StoryReadQuery,
  StoryDates,
} from "@gestaloka/contracts";

const fingerprint = (json: string) =>
  `encode(sha256(convert_to((${json})::text,'UTF8')),'hex')`;

export async function setupStories(pool: pg.Pool) {
  await pool.query(`SELECT pg_advisory_xact_lock(hashtext('player_story_setup'));
  CREATE TABLE IF NOT EXISTS player_story (
    id uuid PRIMARY KEY, world_id uuid NOT NULL, world_title text NOT NULL,
    author_id uuid NOT NULL, author text NOT NULL, title text NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE player_story ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
  CREATE INDEX IF NOT EXISTS player_story_active_latest ON player_story(published_at,id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS player_story_active_world ON player_story(world_id,published_at,id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS player_story_active_author ON player_story(md5(author),published_at,id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS player_story_active_world_author ON player_story(world_id,md5(author),published_at,id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS player_story_active_player ON player_story(md5('stories:' || author_id::text),published_at,id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS player_story_active_title ON player_story(md5(title),published_at,id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS player_story_active_author_order ON player_story(lower(left(author,128)),id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS player_story_active_title_order ON player_story(lower(left(title,128)),id) WHERE deleted_at IS NULL;
  DROP INDEX IF EXISTS player_story_latest,player_story_world,player_story_author,player_story_world_author,
    player_story_player,player_story_title,player_story_author_order,player_story_title_order;
  CREATE TABLE IF NOT EXISTS player_story_episode (
    story_id uuid NOT NULL REFERENCES player_story(id) ON DELETE CASCADE,
    number integer NOT NULL, request_id uuid NOT NULL UNIQUE, body text NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(story_id,number)
  );
  ALTER TABLE player_story_episode ADD COLUMN IF NOT EXISTS image text,
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS title text;
  CREATE INDEX IF NOT EXISTS player_story_episode_active_number ON player_story_episode(story_id,number) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS player_story_episode_active_date ON player_story_episode(story_id,published_at,number) WHERE deleted_at IS NULL;
  DROP INDEX IF EXISTS player_story_episode_date;
  DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='player_story'::regclass AND attname='updated_at' AND NOT attisdropped) THEN
      ALTER TABLE player_story ADD COLUMN updated_at timestamptz;
      UPDATE player_story s SET updated_at=GREATEST(s.published_at,(
        SELECT max(published_at) FROM player_story_episode WHERE story_id=s.id
      ));
      ALTER TABLE player_story ALTER COLUMN updated_at SET DEFAULT now(), ALTER COLUMN updated_at SET NOT NULL;
    END IF;
    IF to_regclass('player_story_request') IS NULL THEN
      CREATE TABLE player_story_request (
        id uuid PRIMARY KEY, story_id uuid NOT NULL REFERENCES player_story(id) ON DELETE CASCADE,
        episode integer NOT NULL, fingerprint text NOT NULL, deleted text
      );
      INSERT INTO player_story_request(id,story_id,episode,fingerprint)
      SELECT e.request_id,e.story_id,e.number,
        ${fingerprint(`jsonb_build_array('post',
          CASE WHEN e.request_id=s.id THEN s.title END,
          CASE WHEN e.request_id=s.id THEN s.author END,
          e.body,e.image)`)}
      FROM player_story_episode e JOIN player_story s ON s.id=e.story_id;
    END IF;
  END $$;
  CREATE INDEX IF NOT EXISTS player_story_active_updated ON player_story(updated_at,id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS player_story_active_world_updated ON player_story(world_id,updated_at,id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS player_story_active_author_updated ON player_story(md5(author),updated_at,id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS player_story_active_world_author_updated ON player_story(world_id,md5(author),updated_at,id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS player_story_active_player_updated ON player_story(md5('stories:' || author_id::text),updated_at,id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS player_story_active_title_updated ON player_story(md5(title),updated_at,id) WHERE deleted_at IS NULL;
  CREATE TABLE IF NOT EXISTS player_story_bookmark (
    user_id uuid NOT NULL, story_id uuid NOT NULL REFERENCES player_story(id) ON DELETE CASCADE,
    PRIMARY KEY(user_id,story_id)
  );`);
}

const playerKey = "md5('stories:' || author_id::text)";
const playerWorlds = (user: string) => `SELECT a.construction_id
  FROM world_access a JOIN world_subject s ON s.id=a.subject_id
  WHERE s.user_id=${user} AND s.active AND a.role='player' AND a.actor_id IS NOT NULL`;
const inPlayerWorld = `world_id IN (${playerWorlds("$1")})`;
const readableStory = `deleted_at IS NULL AND ${inPlayerWorld}`;
const bookmarked = `EXISTS (SELECT 1 FROM player_story_bookmark
  WHERE user_id=$1 AND story_id=player_story.id)`;
const columns = `id,world_id AS "worldId",world_title AS "worldTitle",title,author,
  ${playerKey} AS player,published_at,author_id=$1 AS mine,${bookmarked} AS bookmarked`;
type StoryRow = Omit<z.infer<typeof StoryRead>["story"], "publishedAt"> & {
  published_at: Date;
};
const storyView = ({ published_at, ...story }: StoryRow) => ({
  ...story,
  publishedAt: published_at.toISOString(),
});
const pageSize = 50;
const missing = () =>
  new AccessError(
    404,
    "STORY_NOT_FOUND",
    "作品または指定した話が見つかりません",
  );
const storyOrder = {
  updated: ["updated_at", "id"],
  newest: ["published_at", "id"],
  oldest: ["published_at", "id"],
  player: [playerKey, "published_at", "id"],
  author: ["lower(left(author,128))", "lower(author)", "id"],
  title: ["lower(left(title,128))", "lower(title)", "id"],
};
function dateWhere(
  values: (string | number)[],
  { since, until }: { since?: string | undefined; until?: string | undefined },
) {
  const predicates: string[] = [];
  if (since)
    predicates.push(
      `published_at >= ($${values.push(since)}::date::timestamp AT TIME ZONE 'Asia/Tokyo')`,
    );
  if (until)
    predicates.push(
      `published_at < (($${values.push(until)}::date + 1)::timestamp AT TIME ZONE 'Asia/Tokyo')`,
    );
  return predicates;
}

export class Stories {
  constructor(private readonly pool: pg.Pool) {}

  async worlds(
    user: string,
    {
      before,
      worldId,
    }: { before?: string | undefined; worldId?: string | undefined },
  ) {
    const { rows } = await this.pool.query<{ id: string; title: string }>(
      `SELECT id,public_title AS title FROM world_construction
       WHERE id IN (${playerWorlds("$1")}) AND ($2::uuid IS NULL OR id<$2) AND ($3::uuid IS NULL OR id=$3)
       ORDER BY id DESC LIMIT 51`,
      [user, before ?? null, worldId ?? null],
    );
    return {
      items: rows.slice(0, 50),
      next: rows.length > 50 ? rows[49]!.id : null,
    };
  }

  async list(
    user: string,
    query: z.infer<typeof StoryListQuery>,
  ): Promise<z.infer<typeof StoryList>> {
    const values = [user];
    const filters = [readableStory, ...dateWhere(values, query)];
    if (query.bookmarked) filters.push(bookmarked);
    if (query.worldId) filters.push(`world_id=$${values.push(query.worldId)}`);
    if (query.player)
      filters.push(`${playerKey}=$${values.push(query.player)}`);
    for (const field of ["author", "title"] as const) {
      if (!query[field]) continue;
      const value = `$${values.push(query[field])}`;
      filters.push(`md5(${field})=md5(${value}) AND ${field}=${value}`);
    }
    const sort = query.sort ?? "updated";
    const order = storyOrder[sort];
    const descending = sort === "updated" || sort === "newest";
    if (query.before)
      filters.push(
        `(${order.join(",")})${descending ? "<" : ">"}(SELECT ${order.join(",")} FROM player_story WHERE id=$${values.push(query.before)} AND ${inPlayerWorld})`,
      );
    const { rows } = await this.pool.query<StoryRow & { updated_at: Date }>(
      `SELECT ${columns},updated_at FROM player_story WHERE ${filters.join(" AND ")}
       ORDER BY ${order.map((field) => `${field} ${descending ? "DESC" : "ASC"}`).join(",")} LIMIT ${pageSize + 1}`,
      values,
    );
    const items = rows.slice(0, pageSize).map(({ updated_at, ...story }) => ({
      ...storyView(story),
      updatedAt: updated_at.toISOString(),
    }));
    return { items, next: rows.length > pageSize ? items.at(-1)!.id : null };
  }

  async read(
    user: string,
    id: string,
    query: z.infer<typeof StoryReadQuery>,
  ): Promise<z.infer<typeof StoryRead>> {
    const {
      rows: [story],
    } = await this.pool.query<StoryRow>(
      `SELECT ${columns} FROM player_story WHERE id=$2 AND ${readableStory}`,
      [user, id],
    );
    if (!story) throw missing();
    const values: (string | number)[] = [id];
    const filters = [
      "story_id=$1",
      "deleted_at IS NULL",
      ...dateWhere(values, query),
    ];
    const byDate = query.sort === "newest" || query.sort === "oldest";
    const descending = query.sort === "newest";
    const comparator = descending ? "<" : ">";
    if (query.after) {
      const after = `$${values.push(Number(query.after))}`;
      filters.push(
        byDate
          ? `(published_at,number)${comparator}(SELECT published_at,number FROM player_story_episode WHERE story_id=$1 AND number=${after})`
          : `number>${after}`,
      );
    }
    const direction = descending ? "DESC" : "ASC";
    const [page, entry] = await Promise.all([
      this.pool.query<{
        number: number;
        published_at: Date;
        title: string | null;
      }>(
        `SELECT number,published_at,title FROM player_story_episode WHERE ${filters.join(" AND ")}
         ORDER BY ${byDate ? `published_at ${direction},` : ""}number ${direction} LIMIT ${pageSize + 1}`,
        values,
      ),
      this.pool.query<{
        number: number;
        title: string | null;
        body: string;
        published_at: Date;
        previous: number | null;
        next: number | null;
        has_image: boolean;
        image: string | null;
      }>(
        `SELECT current.number,title,body,published_at,image IS NOT NULL AS has_image,
         CASE WHEN $3::boolean THEN image END AS image,
         (SELECT number FROM player_story_episode WHERE story_id=$1 AND deleted_at IS NULL
          AND number<current.number ORDER BY number DESC LIMIT 1) AS previous,
         (SELECT number FROM player_story_episode WHERE story_id=$1 AND deleted_at IS NULL
          AND number>current.number ORDER BY number LIMIT 1) AS next
         FROM player_story_episode current WHERE story_id=$1 AND deleted_at IS NULL
         AND ($2::integer IS NULL OR current.number=$2) ORDER BY current.number LIMIT 1`,
        [id, query.episode ?? null, query.image === "1"],
      ),
    ]);
    const selected = entry.rows[0];
    if (!selected) throw missing();
    const episodes = page.rows.slice(0, pageSize).map((row) => ({
      number: row.number,
      publishedAt: row.published_at.toISOString(),
      ...(row.title !== null && { title: row.title }),
    }));
    return {
      story: storyView(story),
      episodes,
      episode: {
        number: selected.number,
        ...(selected.title !== null && { title: selected.title }),
        body: selected.body,
        publishedAt: selected.published_at.toISOString(),
        hasImage: selected.has_image,
        ...(selected.image === null ? {} : { image: selected.image }),
      },
      hasNextEpisode: selected.next !== null,
      previousEpisode: selected.previous,
      nextEpisode: selected.next,
      next: page.rows.length > pageSize ? episodes.at(-1)!.number : null,
    };
  }

  /** Counts only stories and episodes that are still published. */
  async stats(
    user: string,
    { worldId, since, until }: z.infer<typeof StoryDates> & { worldId: string },
  ) {
    const values = [user, worldId];
    const period = dateWhere(values, { since, until })
      .map((predicate) => ` AND ${predicate}`)
      .join("");
    const { rows } = await this.pool.query<Record<string, number>>(
      `SELECT (SELECT count(*)::int FROM player_story
         WHERE world_id=$2 AND ${readableStory}${period}) AS stories,
       count(*)::int AS episodes,
       count(*) FILTER (WHERE number=1)::int AS "firstEpisodes",
       count(*) FILTER (WHERE number>1)::int AS "continuedEpisodes",
       count(DISTINCT author_id)::int AS players
       FROM player_story_episode JOIN (SELECT id AS story_id,author_id FROM player_story
         WHERE world_id=$2 AND ${readableStory}) story USING(story_id)
       WHERE deleted_at IS NULL${period}`,
      values,
    );
    return { worldId, since, until, ...rows[0] };
  }

  async bookmark(user: string, id: string, saved: boolean) {
    if (saved) {
      const {
        rows: [result],
      } = await this.pool.query<{ available: boolean }>(
        `WITH available AS (SELECT id FROM player_story WHERE id=$2 AND ${readableStory}),
         saved AS (
           INSERT INTO player_story_bookmark(user_id,story_id) SELECT $1,id FROM available
           ON CONFLICT DO NOTHING
         ) SELECT EXISTS (SELECT 1 FROM available) AS available`,
        [user, id],
      );
      if (!result?.available) return undefined;
    } else {
      await this.pool.query(
        "DELETE FROM player_story_bookmark WHERE user_id=$1 AND story_id=$2",
        [user, id],
      );
    }
    return { bookmarked: saved };
  }

  async post(
    user: string,
    world: string,
    input: z.infer<typeof StoryPost | typeof StoryEdit | typeof StoryDelete>,
  ) {
    const incomingImage = "image" in input ? input.image : undefined;
    const image =
      incomingImage == null
        ? null
        : await staticWebp(incomingImage, STORY_IMAGE_MAX_BYTES, 1600).then(
            (bytes) => bytes.toString("base64"),
            () => {
              throw new AccessError(
                400,
                "STORY_IMAGE_INVALID",
                "JPEG・PNG・WebPの静止画を指定してください（5MiB以下、長辺4096px以下）",
              );
            },
          );
    const db = await this.pool.connect();
    const storyId = "storyId" in input ? input.storyId : input.requestId;
    const posting = !("operation" in input);
    const creation = !("storyId" in input);
    const payload = JSON.stringify(
      posting
        ? [
            "post",
            creation ? input.title : null,
            creation ? input.author : null,
            input.body,
            image,
            ...(input.episodeTitle === undefined ? [] : [input.episodeTitle]),
          ]
        : input.operation === "delete"
          ? ["delete", input.episode]
          : [
              "edit",
              input.episode,
              input.title,
              input.author,
              input.body,
              input.image !== undefined,
              image,
              input.episodeTitle !== undefined,
              input.episodeTitle,
            ],
    );
    try {
      await db.query("BEGIN");
      if (creation) {
        await db.query(
          `INSERT INTO player_story(id,world_id,world_title,author_id,author,title)
           SELECT $1,c.id,c.public_title,$3,$4,$5 FROM world_construction c
           WHERE c.id=$2 AND c.id IN (${playerWorlds("$3")}) ON CONFLICT(id) DO NOTHING`,
          [storyId, world, user, input.author, input.title],
        );
      }
      const {
        rows: [story],
      } = await db.query<{
        author_id: string;
        world_id: string;
        deleted_at: Date | null;
      }>(
        "SELECT author_id,world_id,deleted_at FROM player_story WHERE id=$1 FOR UPDATE",
        [storyId],
      );
      if (!story || story.author_id !== user || story.world_id !== world)
        return "forbidden";
      const {
        rows: [previous],
      } = await db.query<{
        episode: number;
        matches: boolean;
        deleted: "story" | "episode" | null;
      }>(
        `SELECT episode,deleted,story_id=$1 AND fingerprint=${fingerprint("$3::jsonb")} AS matches
         FROM player_story_request WHERE id=$2`,
        [storyId, input.requestId, payload],
      );
      if (previous)
        return previous.matches
          ? {
              storyId,
              episode: previous.episode,
              ...(previous.deleted && { deleted: previous.deleted }),
            }
          : "conflict";
      if (story.deleted_at) return "missing";
      let episode: number;
      let deleted: "story" | "episode" | undefined;
      if (posting) {
        const inserted = await db.query<{ number: number }>(
          `INSERT INTO player_story_episode(story_id,number,request_id,body,image,title)
           VALUES($1,coalesce((SELECT number FROM player_story_episode
             WHERE story_id=$1 ORDER BY number DESC LIMIT 1),0)+1,$2,$3,$4,$5)
           ON CONFLICT(request_id) DO NOTHING RETURNING number`,
          [
            storyId,
            input.requestId,
            input.body,
            image,
            input.episodeTitle ?? null,
          ],
        );
        if (!inserted.rows[0]) return "conflict";
        episode = inserted.rows[0].number;
      } else if (input.operation === "delete") {
        episode = input.episode ?? 1;
        if (input.episode !== undefined) {
          const changed = await db.query(
            "UPDATE player_story_episode SET deleted_at=now() WHERE story_id=$1 AND number=$2 AND deleted_at IS NULL",
            [storyId, episode],
          );
          if (!changed.rowCount) return "missing";
        }
        const removed = await db.query(
          `UPDATE player_story SET deleted_at=now() WHERE id=$1 AND ($2::boolean OR NOT EXISTS (
            SELECT 1 FROM player_story_episode WHERE story_id=$1 AND deleted_at IS NULL
          ))`,
          [storyId, input.episode === undefined],
        );
        deleted = removed.rowCount ? "story" : "episode";
      } else {
        episode = input.episode ?? 1;
        if (input.episode !== undefined) {
          const updated = await db.query(
            `UPDATE player_story_episode SET body=coalesce($3,body),image=CASE WHEN $4 THEN $5 ELSE image END,
             title=CASE WHEN $6 THEN $7 ELSE title END
             WHERE story_id=$1 AND number=$2 AND deleted_at IS NULL`,
            [
              storyId,
              episode,
              input.body ?? null,
              input.image !== undefined,
              image,
              input.episodeTitle !== undefined,
              input.episodeTitle ?? null,
            ],
          );
          if (!updated.rowCount) return "missing";
        }
      }
      const journal = await db.query(
        `INSERT INTO player_story_request(id,story_id,episode,fingerprint,deleted)
         VALUES($1,$2,$3,${fingerprint("$4::jsonb")},$5) ON CONFLICT(id) DO NOTHING`,
        [input.requestId, storyId, episode, payload, deleted ?? null],
      );
      if (!journal.rowCount) return "conflict";
      if (posting || input.operation === "edit")
        await db.query(
          "UPDATE player_story SET updated_at=clock_timestamp(),title=coalesce($2,title),author=coalesce($3,author) WHERE id=$1",
          [
            storyId,
            posting ? null : (input.title ?? null),
            posting ? null : (input.author ?? null),
          ],
        );
      await db.query("COMMIT");
      return { storyId, episode, ...(deleted && { deleted }) };
    } finally {
      try {
        await db.query("ROLLBACK");
      } finally {
        db.release();
      }
    }
  }
}
