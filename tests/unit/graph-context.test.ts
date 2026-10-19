import { expect, test } from "vitest";
import { graphContext } from "../../packages/server/src/runtime/context.js";

test("重複を共通化し、同一IDの異なる本文・期間・観測版と照会ごとの構造を保つ", () => {
  const node = { id: "person", kind: "existence", text: "村民" };
  const edge = {
    id: "seen",
    kind: "see",
    source: "person",
    target: "place",
    text: "門の外側を見た",
    period: { from: 1 },
    observation: {
      aspect: "外側",
      through: 1,
      sourceIds: ["place"],
      pathIds: [],
      versions: { "source:place": 1 },
    },
  };
  const input = {
    request: {
      actionText: '文字列内の {"graphRef":0} はそのまま',
      rootIds: ["person"],
    },
    results: [
      { node, edges: [edge], missing: null },
      {
        node: { text: "村民", kind: "existence", id: "person" },
        edges: [edge],
      },
      { ...node, text: "別の時点の呼称" },
      { ...edge, period: { from: 1, until: 2 } },
      {
        ...edge,
        observation: { ...edge.observation, versions: { "source:place": 2 } },
      },
      { ...edge, text: "門の内側を見た" },
      { kind: "node", id: "person" },
    ],
  };
  const encoded = graphContext(input);
  const { graphObjects, ...payload } = JSON.parse(encoded);
  const restored = JSON.parse(JSON.stringify(payload), (_key, value) =>
    value && typeof value === "object" && "graphRef" in value
      ? graphObjects[value.graphRef]
      : value,
  );
  expect(restored).toEqual(input);
  expect(graphObjects).toHaveLength(6);
  expect(encoded.split("門の外側を見た")).toHaveLength(4);
  expect(encoded.length).toBeLessThan(JSON.stringify(input).length);
  expect(graphContext(input)).toBe(encoded);
});
