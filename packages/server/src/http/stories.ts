import type pg from "pg";
import type { z } from "zod";
import { STORY_IMAGE_MAX_BYTES } from "@gestaloka/contracts";
import { staticWebp } from "../runtime/player-icons.js";
import { AccessError } from "./access.js";
import type {
  StoryList,
  StoryListQuery,
  StoryPost,
  StoryRead,
  StoryReadQuery,
} from "@gestaloka/contracts";

export async function setupStories(pool: pg.Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS player_story (
    id uuid PRIMARY KEY, world_id uuid NOT NULL, world_title text NOT NULL,
    author_id uuid NOT NULL, author text NOT NULL, title text NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS player_story_latest ON player_story(published_at,id);
  CREATE INDEX IF NOT EXISTS player_story_world ON player_story(world_id,published_at,id);
  CREATE INDEX IF NOT EXISTS player_story_author ON player_story(md5(author),published_at,id);
  CREATE INDEX IF NOT EXISTS player_story_world_author ON player_story(world_id,md5(author),published_at,id);
  CREATE INDEX IF NOT EXISTS player_story_player ON player_story(md5('stories:' || author_id::text),published_at,id);
  CREATE INDEX IF NOT EXISTS player_story_title ON player_story(md5(title),published_at,id);
  CREATE INDEX IF NOT EXISTS player_story_author_order ON player_story(lower(left(author,128)),id);
  CREATE INDEX IF NOT EXISTS player_story_title_order ON player_story(lower(left(title,128)),id);
  CREATE TABLE IF NOT EXISTS player_story_episode (
    story_id uuid NOT NULL REFERENCES player_story(id) ON DELETE CASCADE,
    number integer NOT NULL, request_id uuid NOT NULL UNIQUE, body text NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(story_id,number)
  );
  ALTER TABLE player_story_episode ADD COLUMN IF NOT EXISTS image text;
  CREATE INDEX IF NOT EXISTS player_story_episode_date ON player_story_episode(story_id,published_at,number);`);
}

const playerKey = "md5('stories:' || author_id::text)";
const columns = `id,world_id AS "worldId",world_title AS "worldTitle",title,author,
  ${playerKey} AS player,published_at,author_id=$1 AS mine`;
type StoryRow = Omit<z.infer<typeof StoryRead>["story"], "publishedAt"> & {
  published_at: Date;
};
const storyView = ({ published_at, ...story }: StoryRow) => ({
  ...story,
  publishedAt: published_at.toISOString(),
});
const pageSize = 50;
const storyOrder = {
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

  async list(
    user: string,
    query: z.infer<typeof StoryListQuery>,
  ): Promise<z.infer<typeof StoryList>> {
    const values = [user];
    const filters = ["true", ...dateWhere(values, query)];
    if (query.worldId) filters.push(`world_id=$${values.push(query.worldId)}`);
    if (query.player)
      filters.push(`${playerKey}=$${values.push(query.player)}`);
    for (const field of ["author", "title"] as const) {
      if (!query[field]) continue;
      const value = `$${values.push(query[field])}`;
      filters.push(`md5(${field})=md5(${value}) AND ${field}=${value}`);
    }
    const sort = query.sort ?? "newest";
    const order = storyOrder[sort];
    const descending = sort === "newest";
    if (query.before)
      filters.push(
        `(${order.join(",")})${descending ? "<" : ">"}(SELECT ${order.join(",")} FROM player_story WHERE id=$${values.push(query.before)})`,
      );
    const { rows } = await this.pool.query<StoryRow>(
      `SELECT ${columns} FROM player_story WHERE ${filters.join(" AND ")}
       ORDER BY ${order.map((field) => `${field} ${descending ? "DESC" : "ASC"}`).join(",")} LIMIT ${pageSize + 1}`,
      values,
    );
    const items = rows.slice(0, pageSize).map(storyView);
    return { items, next: rows.length > pageSize ? items.at(-1)!.id : null };
  }

  async read(
    user: string,
    id: string,
    query: z.infer<typeof StoryReadQuery>,
  ): Promise<z.infer<typeof StoryRead> | undefined> {
    const values: (string | number)[] = [id];
    const filters = ["story_id=$1", ...dateWhere(values, query)];
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
    const [stories, page, entry] = await Promise.all([
      this.pool.query<StoryRow>(
        `SELECT ${columns} FROM player_story WHERE id=$2`,
        [user, id],
      ),
      this.pool.query<{ number: number; published_at: Date }>(
        `SELECT number,published_at FROM player_story_episode WHERE ${filters.join(" AND ")}
         ORDER BY ${byDate ? `published_at ${direction},` : ""}number ${direction} LIMIT ${pageSize + 1}`,
        values,
      ),
      this.pool.query<{
        number: number;
        body: string;
        published_at: Date;
        next: boolean;
        has_image: boolean;
        image: string | null;
      }>(
        `SELECT number,body,published_at,image IS NOT NULL AS has_image,
         CASE WHEN $3::boolean THEN image END AS image,EXISTS (
          SELECT 1 FROM player_story_episode WHERE story_id=$1 AND number>$2
        ) AS next FROM player_story_episode WHERE story_id=$1 AND number=$2`,
        [id, Number(query.episode ?? 1), query.image === "1"],
      ),
    ]);
    const story = stories.rows[0],
      selected = entry.rows[0];
    if (!story || !selected) return undefined;
    const episodes = page.rows.slice(0, pageSize).map((row) => ({
      number: row.number,
      publishedAt: row.published_at.toISOString(),
    }));
    return {
      story: storyView(story),
      episodes,
      episode: {
        number: selected.number,
        body: selected.body,
        publishedAt: selected.published_at.toISOString(),
        hasImage: selected.has_image,
        ...(selected.image === null ? {} : { image: selected.image }),
      },
      hasNextEpisode: selected.next,
      next: page.rows.length > pageSize ? episodes.at(-1)!.number : null,
    };
  }

  async post(user: string, world: string, input: z.infer<typeof StoryPost>) {
    const image =
      input.image === undefined
        ? null
        : await staticWebp(input.image, STORY_IMAGE_MAX_BYTES, 1600).then(
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
    try {
      await db.query("BEGIN");
      if ("title" in input) {
        await db.query(
          `INSERT INTO player_story(id,world_id,world_title,author_id,author,title)
           SELECT $1,c.id,c.public_title,$3,$4,$5 FROM world_construction c
           WHERE c.id=$2 AND EXISTS (
             SELECT 1 FROM world_access a JOIN world_subject s ON s.id=a.subject_id
             WHERE a.construction_id=c.id AND a.role='player' AND a.actor_id IS NOT NULL
               AND s.active AND s.user_id=$3
           ) ON CONFLICT(id) DO NOTHING`,
          [storyId, world, user, input.author, input.title],
        );
      }
      const {
        rows: [story],
      } = await db.query<{
        author_id: string;
        world_id: string;
        author: string;
        title: string;
      }>(
        "SELECT author_id,world_id,author,title FROM player_story WHERE id=$1 FOR UPDATE",
        [storyId],
      );
      if (!story || story.author_id !== user || story.world_id !== world)
        return "forbidden";
      if (
        "title" in input &&
        (story.title !== input.title || story.author !== input.author)
      )
        return "conflict";
      if ("storyId" in input && input.requestId === storyId) return "conflict";
      const inserted = await db.query<{ number: number }>(
        `INSERT INTO player_story_episode(story_id,number,request_id,body,image)
         VALUES($1,coalesce((SELECT number FROM player_story_episode
           WHERE story_id=$1 ORDER BY number DESC LIMIT 1),0)+1,$2,$3,$4)
         ON CONFLICT(request_id) DO NOTHING RETURNING number`,
        [storyId, input.requestId, input.body, image],
      );
      const episode =
        inserted.rows[0] ??
        (
          await db.query<{ number: number }>(
            `SELECT number FROM player_story_episode WHERE request_id=$2 AND story_id=$1 AND body=$3
             AND image IS NOT DISTINCT FROM $4::text`,
            [storyId, input.requestId, input.body, image],
          )
        ).rows[0];
      if (!episode) return "conflict";
      await db.query("COMMIT");
      return { storyId, episode: episode.number };
    } finally {
      try {
        await db.query("ROLLBACK");
      } finally {
        db.release();
      }
    }
  }
}
