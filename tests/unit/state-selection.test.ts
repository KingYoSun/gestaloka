import { expect, test } from "vitest";
import { selectStates } from "../../packages/server/src/runtime/bot-play.js";

const state = (text: string, from: number) => ({
  relation: { id: `${text}@${from}`, period: { from } },
  node: { text },
});

test("渡す状態は、最も古い時点のものを必ず残し、残りを新しい順に埋め、同じ本文をまとめる", () => {
  // 並びは時点の順ではない。作成時の設定が途中にあり、古い記録と重複が多い。
  const all = [
    ...Array.from({ length: 10 }, (_, i) => state(`途中の記録${i}`, 20 + i)),
    state("作成時の外見", 5),
    state("作成時の性格", 5),
    ...Array.from({ length: 6 }, (_, i) => state("同じ居場所", 40 + i)),
    ...Array.from({ length: 8 }, (_, i) => state(`最近の記録${i}`, 50 + i)),
    state("作成時の外見", 60),
  ];
  const chosen = selectStates(all).map((s) => s.node.text);
  expect(chosen).toHaveLength(12);
  expect(chosen.slice(0, 2)).toEqual(["作成時の外見", "作成時の性格"]);
  expect(chosen.slice(2)).toEqual([
    "途中の記録9",
    "同じ居場所",
    ...Array.from({ length: 8 }, (_, i) => `最近の記録${i}`),
  ]);
  // 上限に満たなければ、重複を除いてすべて残る。
  expect(selectStates(all.slice(10, 14)).map((s) => s.node.text)).toEqual([
    "作成時の外見",
    "作成時の性格",
    "同じ居場所",
  ]);
  expect(selectStates([])).toEqual([]);
});
