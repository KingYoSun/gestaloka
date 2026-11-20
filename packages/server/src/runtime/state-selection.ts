// LLMへ渡す記録の件数の上限。対象や履歴が育っても、1回の入力は件数に依存しない。
export const materialLimit = 12,
  historyLimit = 24;
// 対象の状態からLLMへ渡す分を選ぶ。状態の並びは時点の順ではないため、時点で並べてから絞る。
// その対象で最も古い時点の状態（人物なら作成時の設定）は必ず残し、残りの枠を新しい順に埋める。
// 本文が同じ状態は1件にまとめる。
export const selectStates = <
  T extends {
    relation: { id: string; period: { from: number } };
    node?: { text?: string } | null | undefined;
  },
>(
  all: T[],
) => {
  const sorted = [...all].sort(
      (a, b) => a.relation.period.from - b.relation.period.from,
    ),
    first = sorted[0]?.relation.period.from,
    unique = new Map<string, T>();
  for (const state of sorted) {
    const key = state.node?.text ?? state.relation.id;
    if (unique.get(key)?.relation.period.from !== first) {
      unique.delete(key);
      unique.set(key, state);
    }
  }
  const states = [...unique.values()].sort(
      (a, b) => a.relation.period.from - b.relation.period.from,
    ),
    origin = states
      .filter((s) => s.relation.period.from === first)
      .slice(0, materialLimit),
    room = materialLimit - origin.length;
  return [...origin, ...(room ? states.slice(origin.length).slice(-room) : [])];
};
