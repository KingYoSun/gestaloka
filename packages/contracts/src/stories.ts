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

export const StoryListQuery = z.object({
  worldId: z.uuid().optional(),
  author: title.optional(),
  before: z.uuid().optional(),
});
export const StoryReadQuery = z.object({
  after: episodeQuery.optional(),
  episode: episodeQuery.optional(),
  image: z.literal("1").optional(),
});
const post = z.object({ requestId: z.uuid(), body, image: image.optional() });
export const StoryPost = z.union([
  post.extend({ title, author: title }).strict(),
  post.extend({ storyId: z.uuid() }).strict(),
]);

const Story = z.object({
  id: z.uuid(),
  worldId: z.uuid(),
  worldTitle: z.string(),
  title: z.string(),
  author: z.string(),
  mine: z.boolean(),
});
const Episode = z.object({
  number: episodeNumber,
  publishedAt: z.iso.datetime(),
});
export const StoryList = z.object({
  items: z.array(Story),
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
  next: episodeNumber.nullable(),
});
export const StoryReceipt = z.object({
  storyId: z.uuid(),
  episode: episodeNumber,
});
