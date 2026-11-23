import { z } from "zod";

const title = z.string().trim().min(1);
const body = z.string().refine((text) => text.trim().length > 0);
export const STORY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const image = z.base64().max(4 * Math.ceil(STORY_IMAGE_MAX_BYTES / 3));
const episodeNumber = z.number().int().positive().max(2147483647);
const episodeQuery = z
  .string()
  .regex(/^[1-9][0-9]{0,9}$/)
  .refine((value) => episodeNumber.safeParse(Number(value)).success);

export const StoryDates = z.object({
  since: z.iso.date().optional(),
  until: z.iso.date().optional(),
});
export const StoryListSort = z.enum([
  "updated",
  "newest",
  "oldest",
  "player",
  "author",
  "title",
]);
export const StoryEpisodeFilters = StoryDates.extend({
  sort: z.enum(["number", "newest", "oldest"]).optional(),
});
export const StoryListQuery = StoryDates.extend({
  worldId: z.uuid().optional(),
  author: title.optional(),
  player: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
  title: title.optional(),
  bookmarked: z.literal("1").optional(),
  sort: StoryListSort.optional(),
  before: z.uuid().optional(),
});
export const StoryReadQuery = StoryEpisodeFilters.extend({
  after: episodeQuery.optional(),
  episode: episodeQuery.optional(),
  image: z.literal("1").optional(),
});
const post = z.object({
  requestId: z.uuid(),
  body,
  image: image.optional(),
  episodeTitle: title.optional(),
});
export const StoryPost = z.union([
  post.extend({ title, author: title }).strict(),
  post.extend({ storyId: z.uuid() }).strict(),
]);
export const StoryEdit = z
  .object({
    operation: z.literal("edit"),
    requestId: z.uuid(),
    storyId: z.uuid(),
    episode: episodeNumber.optional(),
    episodeTitle: title.nullable().optional(),
    title: title.optional(),
    author: title.optional(),
    body: body.optional(),
    image: image.nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.episode !== undefined ||
      (input.body === undefined &&
        input.image === undefined &&
        input.episodeTitle === undefined),
    "各話のタイトル、本文、画像を変更するには話数を指定してください",
  )
  .refine(
    ({ title, author, body, image, episodeTitle }) =>
      title !== undefined ||
      author !== undefined ||
      body !== undefined ||
      image !== undefined ||
      episodeTitle !== undefined,
    "修正する項目を指定してください",
  );
export const StoryDelete = z
  .object({
    operation: z.literal("delete"),
    requestId: z.uuid(),
    storyId: z.uuid(),
    episode: episodeNumber.optional(),
  })
  .strict();

const Story = z.object({
  id: z.uuid(),
  worldId: z.uuid(),
  worldTitle: z.string(),
  title: z.string(),
  author: z.string(),
  player: z.string().optional(),
  publishedAt: z.iso.datetime().optional(),
  mine: z.boolean(),
  bookmarked: z.boolean().optional(),
});
export const StoryBookmark = z.object({ bookmarked: z.boolean() }).strict();
const Episode = z.object({
  number: episodeNumber,
  publishedAt: z.iso.datetime(),
  title: z.string().optional(),
});
export const StoryList = z.object({
  items: z.array(Story.extend({ updatedAt: z.iso.datetime().optional() })),
  next: z.uuid().nullable(),
});
export const StoryRead = z.object({
  story: Story,
  episodes: z.array(Episode),
  episode: Episode.extend({
    body,
    hasImage: z.boolean().optional(),
    image: z.base64().optional(),
  }),
  hasNextEpisode: z.boolean(),
  previousEpisode: episodeNumber.nullable().optional(),
  nextEpisode: episodeNumber.nullable().optional(),
  next: episodeNumber.nullable(),
});
export const StoryReceipt = z.object({
  storyId: z.uuid(),
  episode: episodeNumber,
  deleted: z.enum(["story", "episode"]).optional(),
});
