import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  drawTableLimit,
  type DrawTable,
  type DrawTableAction,
} from "@gestaloka/contracts";
import type pg from "pg";
import { AccessError } from "../http/access.js";
import { visibleTo } from "../world/belongings.js";
import { directPlaces } from "../world/locations.js";
import { derivedId } from "../world/model.js";
import type { WorldContext } from "../world/store.js";
import { groundPlacement } from "./search-appearances.js";

const latest = Number.MAX_SAFE_INTEGER;
const text = z.string().trim().min(1);

export const DrawReview = z
  .object({ accepted: z.boolean(), reason: text })
  .strict();
type Db = Pick<pg.Pool, "query">;
type Draft = Pick<DrawTable, "entries" | "price"> & {
  description: string;
  revision: number;
  baseVersionId: string | null;
};
function drawReject(code: string, message: string): never {
  throw new AccessError(409, code, message);
}

export const drawSpCost = (table: Pick<DrawTable, "entries">) =>
  table.entries.some(
    ({ result }) => result.kind === "item" || result.kind === "skill",
  )
    ? 1
    : 0;

const totalWeight = (entries: DrawTable["entries"]) =>
  entries.reduce((sum, { weight }) => sum + BigInt(weight), 0n);

export const drawSkillCapacity = (
  context: WorldContext,
  actor: string,
  table?: DrawTable,
) =>
  !table || table.entries.some(({ result }) => result.kind === "skill")
    ? context.skillCapacityError(actor)
    : undefined;

export function drawEntry(table: DrawTable) {
  const total = totalWeight(table.entries);
  const limit = ((1n << 64n) / total) * total;
  let value: bigint;
  do value = randomBytes(8).readBigUInt64BE();
  while (value >= limit);
  let offset = value % total;
  return table.entries.find(({ weight }) => (offset -= BigInt(weight)) < 0n)!;
}

function tableView(table: Pick<Draft, "entries" | "price">) {
  const { entries, price } = table;
  const total = totalWeight(entries);
  return {
    price,
    totalWeight:
      total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : String(total),
    spCost: drawSpCost(table),
    entries: entries.map((entry) => ({
      ...entry,
      probability: entry.weight / Number(total),
    })),
  };
}

async function managesStorage(
  context: WorldContext,
  actor: string,
  storage: string,
) {
  const installed = await context.installation(storage);
  if (installed) return installed.manager === actor;
  return (await context.relations(storage, "has", "in", latest)).some(
    (edge) => edge.role === "use" && edge.source === actor,
  );
}

export async function requireDrawTableEditor(
  context: WorldContext,
  target: string,
  actor: string,
  table?: DrawTable,
) {
  const node = await context.node(target);
  if (node?.kind !== "existence" || target === actor)
    drawReject(
      "DRAW_TARGET_REQUIRED",
      "既存の場所または物品を指定してください",
    );
  if (
    !table ||
    table.managerId === actor ||
    (await managesStorage(context, actor, target))
  )
    return;
  const held = await context.relations(target, "has", "in", latest);
  if (held.some((edge) => !edge.role && edge.source === actor)) return;
  drawReject(
    "DRAW_TABLE_AUTHORITY",
    "この固定表を編集できる人物を指定してください",
  );
}

export async function heldDrawItem(
  context: WorldContext,
  holder: string,
  itemId: string,
  count: number,
) {
  const item = await context.node(itemId);
  if (
    item?.kind === "existence" &&
    (item.count ?? 1) - (await context.reserved(item.id)) >= count &&
    (await context.relations(item.id, "has", "in", latest)).some(
      (edge) => !edge.role && edge.source === holder,
    )
  )
    return item;
}

export async function tableAvailability(
  context: WorldContext,
  table: DrawTable,
  actor?: string,
) {
  const stock = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof heldDrawItem>>>
  >();
  const place = actor ? (await directPlaces(context, actor))[0] : undefined;
  const usable = async (id: string) =>
    (await managesStorage(context, table.managerId, id)) &&
    (!actor ||
      (!!place &&
        (id === place ||
          (await context.installation(id))?.place === place ||
          (await directPlaces(context, id))[0] === place)));
  const unavailable = {
    code: "DRAW_STOCK_UNAVAILABLE",
    message: "固定表の在庫を補充し、保管先で払い出せるようになるまで引けません",
  };
  for (const { result } of table.entries) {
    if (result.kind !== "stock") continue;
    const item = await heldDrawItem(
      context,
      result.storageId,
      result.itemId,
      result.count,
    );
    if (!item || !(await usable(result.storageId)))
      return { reason: unavailable, stock };
    stock.set(item.id, item);
  }
  if (table.price && !(await usable(table.price.storageId)))
    return {
      reason: {
        code: "DRAW_PAYMENT_UNAVAILABLE",
        message: "代価を受け取る保管先を利用できません",
      },
      stock,
    };
  return { stock };
}

export async function readDrawDraft(
  db: Db,
  world: string,
  actor: string,
  target: string,
) {
  return (
    await db.query<{ data: Draft }>(
      "SELECT data FROM draw_table_draft WHERE world_id=$1 AND target_id=$2 AND actor_id=$3",
      [world, target, actor],
    )
  ).rows[0]?.data;
}

export async function drawTableCommand(
  db: Db,
  world: string,
  context: WorldContext,
  actor: string,
  input: Exclude<DrawTableAction, { command: "draw-table-publish" }>,
) {
  const { targetId } = input;
  const source = await drawSource(context, targetId);
  const table = source?.drawTable;
  if (input.command === "draw-table-show" && input.view === "published") {
    if (!table)
      drawReject(
        "DRAW_TABLE_NOT_PUBLISHED",
        "公開済みの固定表を指定してください",
      );
    if (!(await drawInReach(context, actor, targetId)))
      await requireDrawTableEditor(context, targetId, actor, table);
    return {
      targetId,
      view: "published",
      versionId: table.versionId,
      description: source.text,
      ...tableView(table),
    };
  }
  await requireDrawTableEditor(context, targetId, actor, table);
  let draft = await readDrawDraft(db, world, actor, targetId);
  let changedEntry: { entryId: string; weight: number } | undefined;
  if (input.command === "draw-table-edit" && (!draft || input.fromPublished)) {
    draft = {
      revision: (draft?.revision ?? 0) + 1,
      baseVersionId: table?.versionId ?? null,
      description: source?.text ?? "",
      entries: table?.entries ?? [],
      price: table?.price ?? null,
    };
  } else {
    if (!draft)
      drawReject(
        "DRAW_TABLE_DRAFT_REQUIRED",
        "draw-table-editで下書きを開いてください",
      );
    if (
      input.command === "draw-table-show" ||
      input.command === "draw-table-edit"
    )
      return {
        targetId,
        view: "draft",
        revision: draft.revision,
        baseVersionId: draft.baseVersionId,
        description: draft.description,
        ...tableView(draft),
      };
    if (draft.revision !== input.revision)
      drawReject("DRAW_TABLE_DRAFT_CHANGED", "下書きを読み直してください");
    if (input.command === "draw-table-settings") {
      draft.description = input.description;
      draft.price = input.price;
    } else {
      const entryId = input.entryId ?? input.requestId;
      const index = draft.entries.findIndex(
        (entry) => entry.entryId === entryId,
      );
      if (input.entryId && index < 0)
        drawReject(
          "DRAW_TABLE_ENTRY_NOT_FOUND",
          "下書きの候補を指定してください",
        );
      if (input.command === "draw-table-remove") draft.entries.splice(index, 1);
      else {
        const entry = {
          entryId,
          weight: input.weight ?? draft.entries[index]?.weight ?? 1,
          result: input.result,
        };
        changedEntry = { entryId, weight: entry.weight };
        if (index < 0 && draft.entries.length === drawTableLimit)
          drawReject(
            "DRAW_TABLE_LIMIT",
            `候補は1表につき${drawTableLimit}件までです`,
          );
        draft.entries.splice(
          index < 0 ? draft.entries.length : index,
          index < 0 ? 0 : 1,
          entry,
        );
      }
    }
    draft.revision++;
  }
  await context.validate();
  await db.query(
    `INSERT INTO draw_table_draft(world_id,target_id,actor_id,data) VALUES($1,$2,$3,$4)
     ON CONFLICT(world_id,target_id,actor_id) DO UPDATE SET data=EXCLUDED.data`,
    [world, targetId, actor, draft],
  );
  return {
    targetId,
    view: "draft",
    revision: draft.revision,
    baseVersionId: draft.baseVersionId,
    description: draft.description,
    ...tableView(draft),
    ...changedEntry,
  };
}

export const drawScriptId = (target: string) =>
  derivedId(`${target}:draw-source`);
export const drawEdgeId = (target: string) =>
  derivedId(`${target}:draw-source:content`);

export async function drawSource(context: WorldContext, target: string) {
  const edge = await context.edge(drawEdgeId(target));
  if (
    edge?.kind !== "status" ||
    edge.role !== "content" ||
    edge.source !== target ||
    edge.target !== drawScriptId(target) ||
    edge.period.until !== undefined
  )
    return;
  const script = await context.node(edge.target);
  if (script?.kind === "script" && script.type === "draw-source") return script;
}

export async function drawInReach(
  context: WorldContext,
  actor: string,
  target: string,
) {
  if (target === actor) return false;
  const places = await directPlaces(context, actor);
  if (places.includes(target)) return true;

  const holder = (await context.relations(target, "has", "in", latest)).find(
    (edge) => !edge.role,
  )?.source;
  if (holder === actor) return true;
  if (!places.length || !visibleTo(await context.node(target), actor, true))
    return false;
  if (holder) {
    return (
      places.includes(holder) &&
      !(await context.relations(holder, "has", "in", latest)).some(
        (edge) => edge.role === "use",
      ) &&
      !(await context.installation(holder))
    );
  }
  const installed = await context.installation(target);
  if (installed) return places.includes(installed.place);
  if (
    (await directPlaces(context, target)).some((place) =>
      places.includes(place),
    )
  )
    return true;
  for (const placement of await groundPlacement(context, target))
    if (
      (await context.relations(placement.source, "status", "in", latest)).some(
        (edge) =>
          edge.role === "content" &&
          edge.text === "ground" &&
          places.includes(edge.source),
      )
    )
      return true;
  return false;
}
