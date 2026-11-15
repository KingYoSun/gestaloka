import { z } from "zod";
import { derivedId, type Change, type WorldEdge } from "./model.js";
import type { Lease, WorldContext, WorldStore } from "./store.js";

// 物品・保管先・技能の事実は、hasの役割で表す。役割なしは所有、holdは所在、
// useは保管先の利用、skillは技能。要約と所在の一意性は確定処理が保つ。
const id = z.uuid(),
  text = z.string().trim().min(1),
  basis = text.describe(
    "この事実が成立した根拠。初期設定、または成立した出来事の内容",
  );
export const BelongingOp = z.discriminatedUnion("type", [
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
export class BelongingRejected extends Error {}

const LATEST = Number.MAX_SAFE_INTEGER;

async function plan(
  context: WorldContext,
  commitId: string,
  at: number,
  ops: readonly BelongingOp[],
) {
  const change: Change = { nodes: [], revisions: [], edges: [], endEdges: [] };
  const incoming = (target: string) =>
    context.relations(target, "has", "in", LATEST);
  for (const [index, op] of ops.entries()) {
    const has = (
      key: string,
      source: string,
      target: string,
      role?: WorldEdge["role"],
      text?: string,
    ) =>
      change.edges.push({
        id: derivedId(`${commitId}:${index}:${key}`),
        kind: "has",
        source,
        target,
        ...(role ? { role } : {}),
        ...(text ? { text } : {}),
        period: { from: at },
      });
    const end = (edges: WorldEdge[]) =>
      change.endEdges.push(...edges.map((edge) => edge.id));
    switch (op.type) {
      case "create":
      case "learn": {
        const node = derivedId(`${commitId}:${index}:node`);
        if (op.type === "learn") {
          change.nodes.push({ id: node, kind: "script", text: op.text });
          has("skill", op.person, node, "skill", op.basis);
          break;
        }
        change.nodes.push({ id: node, kind: "existence", text: op.label });
        has("hold", op.holder, node, "hold", op.basis);
        if (op.owner) has("own", op.owner, node, undefined, op.basis);
        break;
      }
      case "move": {
        const held = (await incoming(op.item)).filter(
          (edge) => edge.role === "hold",
        );
        if ((held[0]?.source ?? null) !== op.from)
          throw new BelongingRejected("物品の現在の所在が指定と異なります");
        end(held);
        has("hold", op.to, op.item, "hold", op.basis);
        break;
      }
      case "transfer":
        end((await incoming(op.item)).filter((edge) => !edge.role));
        has("own", op.to, op.item, undefined, op.basis);
        break;
      case "grant":
      case "revoke": {
        const uses = (await incoming(op.storage)).filter(
          (edge) => edge.role === "use" && edge.source === op.person,
        );
        if (op.type === "revoke") end(uses);
        else if (!uses.length)
          has("use", op.person, op.storage, "use", op.basis);
        break;
      }
      case "update": {
        const node = await context.node(op.id),
          facts = (await incoming(op.id)).filter(
            (edge) => edge.role !== "summary",
          );
        if (!node || !facts.length)
          throw new BelongingRejected("物品または技能が見つかりません");
        change.revisions.push({ ...node, text: op.text });
        if (!op.basis) break;
        const skills = facts.filter((edge) => edge.role === "skill");
        end(skills);
        for (const edge of skills)
          has(edge.source, edge.source, op.id, "skill", op.basis);
        break;
      }
      case "remove":
        end((await incoming(op.id)).filter((edge) => edge.role !== "summary"));
    }
  }
  return change;
}

// 同じcommitIdの再送には保存済みの結果を返す。競合はWorldConflictとして呼出し側へ返る。
export async function changeBelongings(
  store: WorldStore,
  lease: Lease,
  input: { commitId: string; at: number; ops: unknown },
) {
  const ops = z.array(BelongingOp).min(1).parse(input.ops);
  const prior = await store.receipt(lease.worldId, input.commitId);
  if (prior) return prior;
  const context = store.context(lease.worldId);
  return store.commit(lease, context, {
    commitId: input.commitId,
    at: input.at,
    changes: await plan(context, input.commitId, input.at, ops),
  });
}

// 取得は関係を読むだけで、観測や世界内の出来事を追加しない。
export async function readBelongings(
  context: WorldContext,
  subject: string,
  at = LATEST,
) {
  const text = async (id: string) => (await context.node(id, at))?.text ?? "";
  const facts = async (holder: string, role: WorldEdge["role"]) =>
    (await context.relations(holder, "has", "out", at)).filter(
      (edge) => edge.role === role,
    );
  const items = async (holder: string) => {
    const held = [];
    for (const edge of await facts(holder, "hold")) {
      const owners = [];
      for (const own of await context.relations(edge.target, "has", "in", at))
        if (!own.role)
          owners.push({ id: own.source, label: await text(own.source) });
      held.push({
        id: edge.target,
        label: await text(edge.target),
        owners,
        basis: edge.text ?? null,
        since: edge.period.from,
      });
    }
    return held;
  };
  const storages = [];
  for (const edge of await facts(subject, "use"))
    storages.push({
      id: edge.target,
      label: await text(edge.target),
      items: await items(edge.target),
    });
  const skills = [];
  for (const edge of await facts(subject, "skill"))
    skills.push({
      id: edge.target,
      text: await text(edge.target),
      basis: edge.text ?? null,
      since: edge.period.from,
    });
  return { items: await items(subject), storages, skills };
}
