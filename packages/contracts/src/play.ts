import { z } from "zod";
import { Change } from "./world.js";

const request = { requestId: z.uuid() },
  text = z.string().trim().min(1);
const id = z.uuid(),
  basis = text.describe(
    "この事実が成立した根拠。初期設定、または成立した出来事の内容",
  );
export const LocationOp = z
  .object({
    type: z.literal("locate"),
    subjectId: z.uuid(),
    text: z.string().trim().min(1),
    aboutIds: z.array(z.uuid()),
  })
  .strict();

export const BelongingOp = z.discriminatedUnion("type", [
  LocationOp,
  z
    .object({
      type: z.literal("create"),
      label: text,
      holder: id,
      owner: id.optional(),
      basis,
    })
    .strict()
    .describe("新しい物品を保持者のもとに成立させる"),
  z
    .object({
      type: z.literal("move"),
      item: id,
      from: id.nullable().describe("現在の保持者。所在が未記録ならnull"),
      to: id,
      basis,
    })
    .strict()
    .describe("物品の所在を移す。所有者は変えない"),
  z
    .object({ type: z.literal("transfer"), item: id, to: id, basis })
    .strict()
    .describe("物品の所有者を替える。所在は変えない"),
  z
    .object({ type: z.literal("grant"), person: id, storage: id, basis })
    .strict()
    .describe("保管先を利用できるようにする"),
  z
    .object({ type: z.literal("revoke"), person: id, storage: id })
    .strict()
    .describe("保管先の利用を終える"),
  z
    .object({ type: z.literal("learn"), person: id, text, basis })
    .strict()
    .describe("できることとその範囲を技能として記録する"),
  z
    .object({ type: z.literal("update"), id, text, basis: basis.optional() })
    .strict()
    .describe(
      "物品の呼称、または技能の内容と範囲を改める。技能の根拠が変わる場合はbasisを指定する",
    ),
  z
    .object({ type: z.literal("remove"), id })
    .strict()
    .describe("消費・消失した物品、または失った技能の所有・所在・習得を終える"),
]);
export type BelongingOp = z.infer<typeof BelongingOp>;
export const PlaySearch = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("surroundings") }).strict(),
  z.object({ kind: z.literal("belongings") }).strict(),
  z.object({ kind: z.literal("self") }).strict(),
  z
    .object({ kind: z.literal("history"), targetId: z.uuid().optional() })
    .strict(),
  z.object({ kind: z.literal("subject"), targetId: z.uuid() }).strict(),
]);
const dependencies = z.array(
  z
    .object({ key: z.string(), version: z.number().int().nonnegative().safe() })
    .strict(),
);
export const PlayCommand = z.discriminatedUnion("command", [
  z.object({ ...request, command: z.literal("start") }).strict(),
  z
    .object({ ...request, command: z.literal("search"), query: PlaySearch })
    .strict(),
  z
    .object({ ...request, command: z.literal("contact"), targetId: z.uuid() })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("say"),
      text,
      instantNpcs: z.array(text).default([]),
    })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("update"),
      text,
      operations: z.array(BelongingOp).min(1).optional(),
      changes: Change.optional(),
      dependencies,
    })
    .strict()
    .refine(
      (v) => !!v.operations !== !!v.changes,
      "operationsかchangesの一方を指定してください",
    ),
  z
    .object({
      ...request,
      command: z.literal("create"),
      text,
      changes: Change,
      dependencies,
    })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("oppose"),
      text,
      operations: z.array(BelongingOp).min(1).optional(),
      changes: Change.optional(),
      dependencies,
    })
    .strict()
    .refine(
      (v) => !!v.operations !== !!v.changes,
      "operationsかchangesの一方を指定してください",
    ),
  z
    .object({
      ...request,
      command: z.literal("receive"),
      applicationId: z.uuid(),
      accept: z.boolean(),
    })
    .strict(),
  z.object({ ...request, command: z.literal("comment"), text }).strict(),
  z
    .object({ ...request, command: z.enum(["end-turn", "leave", "finish"]) })
    .strict(),
]);
export const PlayResponse = z.record(z.string(), z.unknown());
