import { z } from "zod";
import {
  derivedId,
  type Change,
  type WorldEdge,
  type WorldNode,
} from "./model.js";
import type { Lease, WorldContext, WorldStore } from "./store.js";
import type { Dependency } from "./store.js";

// 物品・保管先・技能の事実は、hasの役割で表す。holdは物品を持つこと（持つ存在の物であること）、
// useは家・場所の保管先の登録、skillは技能。要約と持つ存在の一意性は確定処理が保つ。
// 所在地はlocate操作で同じ原子的確定を使い、statusのlocation記録として保存する。
export { BelongingOp } from "@gestaloka/contracts";
import { BelongingOp } from "@gestaloka/contracts";
export class BelongingRejected extends Error {}
// モデルは操作を1件ずつJSON文字列で返す。操作の形を応答スキーマへ並べると、
// 行動解決の構造化出力が文法の上限を超えるため、形は実行側で検証する。
export function belongingOps(texts: readonly string[]) {
  try {
    return z
      .array(BelongingOp)
      .parse(texts.map((text) => JSON.parse(text) as unknown));
  } catch (error) {
    throw new BelongingRejected(
      `操作の形式が不正です: ${error instanceof Error ? error.message : ""}`,
    );
  }
}

const LATEST = Number.MAX_SAFE_INTEGER;

// 操作を差分へ変える。進行中のシーンは世界内の時点が互いにずれるため、終了・改訂する
// 記録より前の時点を指定された場合は、その記録の時点まで確定時点を進める。
export async function planBelongings(
  context: WorldContext,
  commitId: string,
  requestedAt: number,
  ops: readonly BelongingOp[],
) {
  const change: Change = { nodes: [], revisions: [], edges: [], endEdges: [] };
  let at = requestedAt;
  const incoming = async (target: string) =>
    (await context.relations(target, "has", "in", LATEST)).filter(
      (edge) => edge.role !== "summary",
    );
  const has = (
    key: string,
    source: string,
    target: string,
    role?: WorldEdge["role"],
    text?: string,
  ) =>
    change.edges.push({
      id: derivedId(`${commitId}:${key}`),
      kind: "has",
      source,
      target,
      ...(role ? { role } : {}),
      ...(text ? { text } : {}),
      period: { from: requestedAt },
    });
  const end = (edges: WorldEdge[]) => {
    at = Math.max(at, ...edges.map((edge) => edge.period.from));
    change.endEdges.push(...edges.map((edge) => edge.id));
  };
  // 同じ確定で改訂する物品・技能。個数の増減はここに重ね、ノードごとに一度だけ改訂する。
  const revised = new Map<string, WorldNode>();
  const current = async (id: string) =>
    revised.get(id) ?? (await context.node(id));
  const revise = async (node: WorldNode) => {
    at = Math.max(at, (await context.latestTime(node.id)) ?? 0);
    revised.set(node.id, node);
  };
  // 物品からcount個を取り分ける。全部を指すときはtrueを返し、物品そのものを扱わせる。
  const take = async (id: string, count: number | undefined) => {
    const node = await current(id);
    if (
      count === undefined ||
      (node?.kind === "existence" && node.count === count)
    )
      return true;
    if (node?.kind !== "existence" || !node.count || count > node.count)
      throw new BelongingRejected("指定した個数の物品がありません");
    await revise({ ...node, count: node.count - count });
    return false;
  };
  // 移す物品の取り分。最後に差分へ変える。
  const parts: {
    key: string;
    item: string;
    count?: number;
    to: string;
    basis: string;
  }[] = [];
  for (const [index, op] of ops.entries()) {
    if (
      op.type === "locate" &&
      ops
        .slice(index + 1)
        .some(
          (next) => next.type === "locate" && next.subjectId === op.subjectId,
        )
    )
      continue;
    switch (op.type) {
      case "locate": {
        const ids = [...new Set(op.aboutIds)];
        const direct =
          op.directPlaceId ?? (ids.length === 1 ? ids[0] : undefined);
        if (direct && !ids.includes(direct))
          throw new BelongingRejected("直接の滞在先をaboutIdsに含めてください");
        const { latest, last, active } = await context.locations(op.subjectId);
        at = Math.max(at, last);
        if (
          active.length === 1 &&
          active[0]!.period.from === latest &&
          (await context.node(active[0]!.target))?.text === op.text
        ) {
          const about = (
            await context.relations(active[0]!.target, "status", "out", LATEST)
          ).filter((e) => e.role === "about");
          if (
            JSON.stringify(about.map((e) => e.target).sort()) ===
              JSON.stringify(ids.sort()) &&
            about.find((e) => e.text === "direct-place")?.target === direct
          )
            break;
        }
        for (const edge of active) {
          end([edge]);
          end(
            (
              await context.relations(edge.target, "status", "out", LATEST)
            ).filter((e) => e.role === "about"),
          );
        }
        const node = derivedId(`${commitId}:${index}:node`);
        change.nodes.push({ id: node, kind: "script", text: op.text });
        change.edges.push({
          id: derivedId(`${node}:content`),
          kind: "status",
          role: "content",
          source: op.subjectId,
          target: node,
          text: "location",
          period: { from: at },
        });
        for (const target of new Set(op.aboutIds))
          change.edges.push({
            id: derivedId(`${node}:${target}`),
            kind: "status",
            role: "about",
            source: node,
            target,
            ...(target === direct ? { text: "direct-place" } : {}),
            period: { from: at },
          });
        break;
      }
      case "create":
      case "learn": {
        const node = derivedId(`${commitId}:${index}:node`);
        if (op.type === "learn") {
          change.nodes.push({ id: node, kind: "script", text: op.text });
          has(`${index}:skill`, op.person, node, "skill", op.basis);
          break;
        }
        change.nodes.push({
          id: node,
          kind: "existence",
          text: op.label,
          ...(op.count ? { count: op.count } : {}),
        });
        has(`${index}:hold`, op.holder, node, "hold", op.basis);
        break;
      }
      case "move": {
        if (
          ((await incoming(op.item)).find((edge) => edge.role === "hold")
            ?.source ?? null) !== op.from
        )
          throw new BelongingRejected("物品の現在の所在が指定と異なります");
        parts.push({
          key: `${index}:${op.item}`,
          item: op.item,
          ...((await take(op.item, op.count)) ? {} : { count: op.count! }),
          to: op.to,
          basis: op.basis,
        });
        break;
      }
      case "grant":
      case "revoke": {
        const uses = (await incoming(op.storage)).filter(
          (edge) => edge.role === "use" && edge.source === op.person,
        );
        if (op.type === "revoke") end(uses);
        else if (!uses.length)
          has(`${index}:use`, op.person, op.storage, "use", op.basis);
        break;
      }
      case "update": {
        const node = await current(op.id),
          facts = await incoming(op.id);
        if (!node || !facts.length)
          throw new BelongingRejected("物品または技能が見つかりません");
        if (op.count && node.kind !== "existence")
          throw new BelongingRejected("個数は物品にだけ指定できます");
        if (
          node.kind === "existence" &&
          node.seriesId &&
          (op.count ?? 0) > (node.count ?? 0)
        )
          throw new BelongingRejected(
            "系列のある物品の個数を増やすには管理者の確定が必要です",
          );
        await revise({
          ...node,
          ...(op.text ? { text: op.text } : {}),
          ...(op.count ? { count: op.count } : {}),
        } as WorldNode);
        if (!op.basis) break;
        const skills = facts.filter((edge) => edge.role === "skill");
        end(skills);
        for (const edge of skills)
          has(`${index}:${edge.source}`, edge.source, op.id, "skill", op.basis);
        break;
      }
      case "remove":
        if (await take(op.id, op.count)) end(await incoming(op.id));
    }
  }
  const moving = new Set(parts.map((part) => part.item));
  for (const part of parts) {
    const source = (await current(part.item))!,
      held = (await incoming(part.item)).filter((edge) => edge.role === "hold"),
      count =
        part.count ?? (source.kind === "existence" ? source.count : undefined);
    // 移った先に、呼称と系列が同じ個数つきの物品があれば、そこへ足して物品を増やさない。
    let merged: WorldNode | undefined;
    if (count)
      for (const edge of await context.relations(
        part.to,
        "has",
        "out",
        LATEST,
      )) {
        const node = await current(edge.target);
        if (
          edge.role === "hold" &&
          !moving.has(edge.target) &&
          node?.kind === "existence" &&
          node.count &&
          node.text === source.text &&
          node.seriesId ===
            (source.kind === "existence" ? source.seriesId : undefined)
        ) {
          merged = { ...node, count: node.count + count };
          break;
        }
      }
    if (merged) {
      await revise(merged);
      if (!part.count) end(await incoming(part.item));
    } else if (part.count) {
      const node = derivedId(`${commitId}:${part.key}:part`);
      change.nodes.push({
        id: node,
        kind: "existence",
        text: source.text,
        count: part.count,
        ...(source.kind === "existence" && source.seriesId
          ? { seriesId: source.seriesId }
          : {}),
      });
      has(`${part.key}:hold`, part.to, node, "hold", part.basis);
    } else {
      end(held);
      has(`${part.key}:hold`, part.to, part.item, "hold", part.basis);
    }
  }
  change.revisions.push(...revised.values());
  for (const edge of change.edges) edge.period = { from: at };
  return { at, changes: change };
}

// 同じcommitIdの再送には保存済みの結果を返す。競合はWorldConflictとして呼出し側へ返る。
export async function changeBelongings(
  store: WorldStore,
  lease: Lease,
  input: {
    commitId: string;
    at: number;
    ops: unknown;
    nodes?: Change["nodes"];
    dependencies?: readonly Dependency[];
  },
) {
  const ops = z.array(BelongingOp).min(1).parse(input.ops);
  const prior = await store.receipt(lease.worldId, input.commitId);
  if (prior) return prior;
  const context = store.context(lease.worldId, input.dependencies),
    planned = await planBelongings(context, input.commitId, input.at, ops);
  if (input.nodes?.some((node) => node.kind === "existence" && node.seriesId))
    throw new BelongingRejected("物品へ系列を付けるには管理者の確定が必要です");
  planned.changes.nodes.unshift(...(input.nodes ?? []));
  return store.commit(
    lease,
    context,
    {
      commitId: input.commitId,
      ...planned,
    },
    true,
  );
}

// 物品の呼称と、個数つきなら個数。
// 設定した閲覧範囲。省いた記録には出さない。
const shown = (node: WorldNode | undefined) =>
  node && "viewers" in node && node.viewers !== undefined
    ? { viewers: node.viewers }
    : {};
const labelled = (node: WorldNode | undefined) => ({
  label: node?.text ?? "",
  ...(node?.kind === "existence" && node.count ? { count: node.count } : {}),
  ...(node?.kind === "existence" && node.seriesId
    ? { seriesId: node.seriesId }
    : {}),
  ...shown(node),
});

// 本人以外の参加者が読めるか。範囲を省いた記録は、種類ごとの既定(open)に従う。
export const visibleTo = (
  node: WorldNode | undefined,
  viewer: string,
  open: boolean,
) => {
  const viewers = node && "viewers" in node ? node.viewers : undefined;
  return viewers === undefined
    ? open
    : viewers === "all" || viewers.includes(viewer);
};

// その場にいる相手が手にしている物。保管先の中身は外から見えないものとして含めない。
// viewerを渡すと、その参加者が読める物だけを返す。
export async function heldItems(
  context: WorldContext,
  holder: string,
  at = LATEST,
  viewer?: string,
) {
  const held = (await context.relations(holder, "has", "out", at)).filter(
    (edge) => edge.role === "hold",
  );
  if (
    !held.length ||
    (await context.relations(holder, "has", "in", at)).some(
      (edge) => edge.role === "use",
    )
  )
    return [];
  const items = [];
  for (const edge of held) {
    const node = await context.node(edge.target, at);
    if (!viewer || visibleTo(node, viewer, true))
      items.push({ id: edge.target, ...labelled(node) });
  }
  return items;
}

// 取得は関係を読むだけで、観測や世界内の出来事を追加しない。
// viewerを渡すと、その参加者が読める物・保管先・技能だけを返す。
export async function readBelongings(
  context: WorldContext,
  subject: string,
  at = LATEST,
  viewer?: string,
) {
  const facts = async (holder: string, role: WorldEdge["role"]) =>
    (await context.relations(holder, "has", "out", at))
      .filter((edge) => edge.role === role)
      // 要約と同じく、成立した順に並べる。
      .sort(
        (x, y) => x.period.from - y.period.from || x.id.localeCompare(y.id),
      );
  const items = async (holder: string) => {
    const held = [];
    for (const edge of await facts(holder, "hold")) {
      const node = await context.node(edge.target, at);
      if (viewer && !visibleTo(node, viewer, true)) continue;
      held.push({
        id: edge.target,
        ...labelled(node),
        basis: edge.text ?? null,
        since: edge.period.from,
      });
    }
    return held;
  };
  // 登録した保管先。中身はどこからでも読める。
  const storages = [];
  for (const edge of await facts(subject, "use")) {
    const node = await context.node(edge.target, at);
    if (viewer && !visibleTo(node, viewer, false)) continue;
    storages.push({
      id: edge.target,
      label: node?.text ?? "",
      ...shown(node),
      items: await items(edge.target),
    });
  }
  const skills = [];
  for (const edge of await facts(subject, "skill")) {
    const node = await context.node(edge.target, at);
    if (viewer && !visibleTo(node, viewer, false)) continue;
    skills.push({
      id: edge.target,
      text: node?.text ?? "",
      ...shown(node),
      basis: edge.text ?? null,
      since: edge.period.from,
    });
  }
  return { items: await items(subject), storages, skills };
}
