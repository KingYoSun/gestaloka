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
  CREATE TABLE IF NOT EXISTS player_story_episode (
    story_id uuid NOT NULL REFERENCES player_story(id) ON DELETE CASCADE,
    number integer NOT NULL, request_id uuid NOT NULL UNIQUE, body text NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(story_id,number)
  );
  ALTER TABLE player_story_episode ADD COLUMN IF NOT EXISTS image text;`);
}

const columns = `id,world_id AS "worldId",world_title AS "worldTitle",title,author,author_id=$1 AS mine`;
const pageSize = 50;

export class Stories {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    user: string,
    query: z.infer<typeof StoryListQuery>,
  ): Promise<z.infer<typeof StoryList>> {
    const values = [user];
    const filters = ["true"];
    if (query.worldId) filters.push(`world_id=$${values.push(query.worldId)}`);
    if (query.author) {
      const author = `$${values.push(query.author)}`;
      filters.push(`md5(author)=md5(${author}) AND author=${author}`);
    }
    if (query.before)
      filters.push(
        `(published_at,id)<(SELECT published_at,id FROM player_story WHERE id=$${values.push(query.before)})`,
      );
    const { rows } = await this.pool.query<
      z.infer<typeof StoryList>["items"][number]
    >(
      `SELECT ${columns} FROM player_story WHERE ${filters.join(" AND ")}
       ORDER BY published_at DESC,id DESC LIMIT ${pageSize + 1}`,
      values,
    );
    const items = rows.slice(0, pageSize);
    return { items, next: rows.length > pageSize ? items.at(-1)!.id : null };
  }

  async read(
    user: string,
    id: string,
    query: z.infer<typeof StoryReadQuery>,
  ): Promise<z.infer<typeof StoryRead> | undefined> {
    const [stories, page, entry] = await Promise.all([
      this.pool.query<z.infer<typeof StoryRead>["story"]>(
        `SELECT ${columns} FROM player_story WHERE id=$2`,
        [user, id],
      ),
      this.pool.query<{ number: number; published_at: Date }>(
        `SELECT number,published_at FROM player_story_episode WHERE story_id=$1 AND number>$2
         ORDER BY number LIMIT ${pageSize + 1}`,
        [id, Number(query.after ?? 0)],
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
      story,
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
