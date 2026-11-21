import { expect, test } from "vitest";
import { locationRecords } from "../../packages/server/src/world/locations.js";
import type { WorldContext } from "../../packages/server/src/world/store.js";

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
