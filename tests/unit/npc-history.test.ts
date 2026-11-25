import { expect, test, vi } from "vitest";
import { classifyNpcHistory } from "../../packages/server/src/runtime/npc-history.js";
import { decisionSettings } from "../../packages/server/src/llm/config.js";

test("発言の出所と訂正を残し、完全一致には判断を使わず、分類済みの組は再送しない", async () => {
  const rows = [
    "鍵は戻った",
    "鍵は戻った",
    "鍵は返ってきた",
    "訂正する。戻ったのは予備の鍵だ",
  ].map((input, i) => ({
    id: String(i + 1),
    payload: {
      entries: [
        {
          actorId: "keeper",
          input,
          result: { state: "accepted", instantNpcs: [] },
        },
      ],
    },
  }));
  const model = {
    decision: decisionSettings({ LLM_DECISION_MODEL: "fixture" }),
    decide: vi.fn(async () => ({ p0: 0.99, p1: 0.1 })),
  };
  const run = () => classifyNpcHistory(rows, "npc", undefined, model, "trial");
  const result = await run();
  expect(result.rows[1]?.payload.entries[0]).toMatchObject({ repeatOf: "1.0" });
  expect(result.rows[2]?.payload.entries[0]).toMatchObject({ repeatOf: "1.0" });
  expect(result.rows[3]?.payload.entries[0]?.input).toBe(
    rows[3]!.payload.entries[0]!.input,
  );
  await classifyNpcHistory(rows, "npc", result.comparisons, model, "next");
  expect(model.decide).toHaveBeenCalledTimes(1);
});

test("相手の最新の聞き直しは原文で渡し、次の発言が届けば過去の反復として扱う", async () => {
  const speech = (actorId: string, input: string) => ({
    actorId,
    input,
    result: { state: "accepted", instantNpcs: [] },
  });
  const question = speech("player", "台木は何本？");
  const again = speech("player", "聞き取れなかった。台木は何本？");
  const reply = speech("npc", "二本だよ。");
  const rows = [
    { id: "1", payload: { entries: [question, reply] } },
    { id: "2", payload: { entries: [again, reply] } },
  ];
  const model = {
    decision: decisionSettings({ LLM_DECISION_MODEL: "fixture" }),
    decide: vi.fn(async () => ({ p0: 0.81 })),
  };
  const first = await classifyNpcHistory(
    rows,
    "npc",
    undefined,
    model,
    "first",
  );
  expect(first.rows[1]?.payload.entries[0]).toEqual(again);
  expect(first.rows[1]?.payload.entries[1]).toMatchObject({ repeatOf: "1.1" });
  const next = await classifyNpcHistory(
    [
      ...rows,
      { id: "3", payload: { entries: [speech("other", "こんにちは")] } },
    ],
    "npc",
    first.comparisons,
    model,
    "next",
  );
  expect(next.rows[1]?.payload.entries[0]).toMatchObject({ repeatOf: "1.0" });
  expect(model.decide).toHaveBeenCalledTimes(1);
});
