import { z } from "zod";

const id = z.uuid();
const text = z.string().trim().min(1);
const count = z.number().int().positive().safe();

export const DrawReward = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("item"), label: text }).strict(),
  z.object({ kind: z.literal("skill"), text }).strict(),
]);
export const DrawTableResult = z.discriminatedUnion("kind", [
  ...DrawReward.options,
  z.object({ kind: z.literal("message"), text }).strict(),
  z
    .object({ kind: z.literal("stock"), storageId: id, itemId: id, count })
    .strict(),
]);
const DrawPrice = z
  .object({
    storageId: id,
    paymentSeriesId: id,
    paymentLabel: text,
    count,
  })
  .strict();
const DrawWeight = count;
const DrawEntry = z
  .object({ entryId: id, weight: DrawWeight, result: DrawTableResult })
  .strict();
export const drawTableLimit = 32;
export const DrawTable = z
  .object({
    versionId: id,
    managerId: id,
    entries: z.array(DrawEntry).min(1).max(drawTableLimit),
    summons: z
      .record(id, text)
      .optional()
      .describe("公開時に判定した景品ごとの召喚先"),
    price: DrawPrice.nullable(),
  })
  .strict();
export type DrawTable = z.infer<typeof DrawTable>;
export type DrawTableResult = z.infer<typeof DrawTableResult>;

const target = { requestId: id, targetId: id };
const draft = { ...target, revision: count };
export const DrawTableActions = [
  z
    .object({
      ...target,
      command: z.literal("draw-table-edit"),
      fromPublished: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      ...target,
      command: z.literal("draw-table-show"),
      view: z.enum(["draft", "published"]),
    })
    .strict(),
  z
    .object({
      ...draft,
      command: z.literal("draw-table-settings"),
      description: text,
      price: DrawPrice.nullable(),
    })
    .strict(),
  z
    .object({
      ...draft,
      command: z.literal("draw-table-put"),
      entryId: id.optional(),
      weight: DrawWeight.optional(),
      result: DrawTableResult,
    })
    .strict(),
  z
    .object({ ...draft, command: z.literal("draw-table-remove"), entryId: id })
    .strict(),
  z.object({ ...draft, command: z.literal("draw-table-publish") }).strict(),
] as const;
export type DrawTableAction = z.infer<(typeof DrawTableActions)[number]>;
