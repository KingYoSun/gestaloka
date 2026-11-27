import type { ConditionExpression, WorldEdge } from "@gestaloka/contracts";
import { derivedId } from "./model.js";

export const instantPlaceEdge = (actor: string) =>
  derivedId(actor + ":instant-place-edge");

export type ConditionReader = {
  activeEdge(id: string): Promise<WorldEdge | undefined>;
  hasActiveRelation(
    id: string,
    kind: WorldEdge["kind"],
    direction: "in" | "out",
    role: WorldEdge["role"] | null,
    text: string | undefined,
    opposite: string | undefined,
  ): Promise<boolean>;
  directPlace(nodeId: string): Promise<string | undefined | null>;
};

function directPlaceSubject(operand: string) {
  return operand.match(
    /^([0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12})\.directPlaceId$/,
  )?.[1];
}

export async function evaluateCondition(
  expression: ConditionExpression,
  reader: ConditionReader,
): Promise<boolean | undefined> {
  if ("all" in expression || "any" in expression) {
    const all = "all" in expression;
    let unknown = false;
    for (const child of all ? expression.all : expression.any) {
      const result = await evaluateCondition(child, reader);
      if (result === undefined) unknown = true;
      else if (result !== all) return result;
    }
    return unknown ? undefined : all;
  }
  if ("eq" in expression) {
    const [left, right] = await Promise.all(
      expression.eq.map((operand) => {
        const nodeId = directPlaceSubject(operand);
        return nodeId ? reader.directPlace(nodeId) : operand;
      }),
    );
    // null は退場が記録された個体、undefined は所在が不明な存在。
    if (left === null || right === null) return false;
    return left === undefined || right === undefined
      ? undefined
      : left === right;
  }

  const { id, kind, source, target, role, text } = expression;
  const matches = (edge: WorldEdge) =>
    (kind === undefined || edge.kind === kind) &&
    (source === undefined || edge.source === source) &&
    (target === undefined || edge.target === target) &&
    (role === undefined || (edge.role ?? null) === role) &&
    (text === undefined || edge.text === text);
  if (id !== undefined) {
    const edge = await reader.activeEdge(id);
    return edge !== undefined && matches(edge);
  }
  const anchor = source ?? target;
  if (!kind || !anchor) return undefined;
  return reader.hasActiveRelation(
    anchor,
    kind,
    source ? "out" : "in",
    role,
    text,
    source ? target : undefined,
  );
}

export function conditionAnchors(expression: ConditionExpression) {
  const edgeIds = new Set<string>();
  const nodeIds = new Set<string>();
  const collect = (child: ConditionExpression) => {
    if ("all" in child || "any" in child) {
      for (const entry of "all" in child ? child.all : child.any)
        collect(entry);
    } else if ("eq" in child) {
      for (const operand of child.eq) {
        const nodeId = directPlaceSubject(operand);
        if (nodeId) nodeIds.add(nodeId);
      }
    } else {
      if (child.id) edgeIds.add(child.id);
      if (child.source) nodeIds.add(child.source);
      if (child.target) nodeIds.add(child.target);
    }
  };
  collect(expression);
  return { edgeIds: [...edgeIds], nodeIds: [...nodeIds] };
}
