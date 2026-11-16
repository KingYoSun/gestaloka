import { expect, test } from "vitest";
import { readLocations } from "../../packages/server/src/world/locations.js";
import type { WorldContext } from "../../packages/server/src/world/store.js";

test("終了した最新の所在から古い所在へ戻らず、別の状態を所在にしない", async () => {
  const context = {
    history: async () => [
      { role: "content", text: "location", target: "old", period: { from: 0 } },
      {
        role: "content",
        text: "location",
        target: "new",
        period: { from: 10, until: 20 },
      },
      { role: "content", target: "private", period: { from: 30 } },
    ],
    relations: async () => [],
    node: async (id: string) => ({
      text: id === "new" ? "入口の外" : "私的な状態",
    }),
  } as unknown as WorldContext;
  expect(await readLocations(context, "actor", 15)).toEqual(["入口の外"]);
  expect(await readLocations(context, "actor", 30)).toEqual([]);
});
