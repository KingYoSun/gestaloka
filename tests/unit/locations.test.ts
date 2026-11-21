import { expect, test } from "vitest";
import {
  addRoute,
  generatedFixedPlaces,
  locationRecords,
  routeEndpoints,
} from "../../packages/server/src/world/locations.js";
import type { Change } from "@gestaloka/contracts";
import type { WorldContext } from "../../packages/server/src/world/store.js";

test("生成時の固定場所は新規の場所だけで、居場所の参照・操作人物・所持品を含めない", () => {
  const changes: Change = {
    nodes: ["家", "人物", "机"].map((id) => ({
      id,
      kind: "existence",
      text: id,
    })),
    revisions: [],
    edges: [],
    endEdges: [],
  };
  addRoute(
    changes,
    "経路",
    0,
    { id: "既存の道", text: "道" },
    { id: "新しい道", text: "道" },
    "往来",
  );
  changes.edges.push({
    id: "所持",
    kind: "has",
    source: "人物",
    target: "机",
    period: { from: 0 },
  });
  const declared = ["家", "人物", "机", "既存の場所"];
  expect(generatedFixedPlaces(changes, declared, "人物").sort()).toEqual([
    "家",
    "新しい道",
  ]);
  const withoutReturn = changes.edges.filter(
    (e) => !(e.role === "about" && e.target === "新しい道"),
  );
  expect(routeEndpoints(withoutReturn).size).toBe(0);
});

test("終了した最新の所在から、古い有効な所在へ戻らない", async () => {
  const old = {
    id: "edge",
    role: "content",
    text: "location",
    target: "old",
    period: { from: 0 },
  };
  const context = (latest: number) =>
    ({
      locations: async () => ({ latest, last: 20, active: [old] }),
      relations: async () => [],
      node: async () => ({ text: "入口の外" }),
    }) as unknown as WorldContext;
  expect(await locationRecords(context(10), "actor")).toEqual([]);
  expect(await locationRecords(context(0), "actor")).toMatchObject([
    { text: "入口の外", at: 0 },
  ]);
});
