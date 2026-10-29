import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import {
  mergeSceneChanges,
  sceneAgenda,
  sceneContinuations,
  sceneAnchors,
  sceneView,
  sceneResponse,
  sceneArrivals,
  type SceneBackground,
} from "../../packages/server/src/runtime/scene-data.js";
const actor = randomUUID(),
  npc = randomUUID(),
  place = randomUUID(),
  event = randomUUID();
const bg: SceneBackground = {
  type: "background",
  synopsis: "道端で話す",
  participants: [actor, npc],
  facts: [{ subjectId: npc, text: "質問を聞く前の状態", aboutIds: [place] }],
  perceptions: [],
  unknowns: [],
  creations: [],
  beliefs: [],
};
const events = [
  {
    id: event,
    actorId: actor,
    text: "質問した",
    period: { from: 0, until: 1000 },
    receipts: [{ observerId: npc, text: "質問を聞いた" }],
  },
];
test("開始時の状態の終了と、表示済みの発言・受容の変更禁止を区別する", () => {
  const anchors = sceneAnchors(bg, events, 0, randomUUID()),
    state = anchors.edges.find(
      (e) => e.kind === "status" && e.role === "content",
    )!,
    see = anchors.edges.find((e) => e.kind === "see")!;
  const result = mergeSceneChanges(
    anchors,
    { nodes: [], edges: [], revisions: [], endEdges: [state.id] },
    1000,
  );
  expect(result.nodes).toEqual(anchors.nodes);
  expect(
    result.edges
      .filter((e) => e.kind === "status")
      .every((e) => e.period.until === 1000),
  ).toBe(true);
  expect(result.edges.find((e) => e.id === see.id)).toEqual(see);
  expect(result.endEdges).toEqual([]);
  expect(() =>
    mergeSceneChanges(
      anchors,
      { nodes: [], edges: [], revisions: [], endEdges: [see.id] },
      1000,
    ),
  ).toThrow("受容");
  expect(() =>
    mergeSceneChanges(
      anchors,
      {
        nodes: [],
        edges: [],
        revisions: [{ ...anchors.nodes.at(-1)!, text: "取り消した" }],
        endEdges: [],
      },
      1000,
    ),
  ).toThrow("改訂");
  const view = sceneView(
    { observerId: npc, at: 0, observations: [], interpretations: [] },
    bg,
    events,
    ["本人の継続"],
    1000,
  );
  expect(view.at).toBe(1000);
  expect(view.observations[0]?.period).toEqual({ from: 0, until: 1000 });
  expect(view.ownIntentions).toEqual(["本人の継続"]);
});
test("時点を進めても元の活動・本人の返答待ち・未実施の判断を落とさず保持する", () => {
  const other = randomUUID(),
    oldId = randomUUID();
  const old = [
    {
      id: oldId,
      at: 0,
      actorId: npc,
      mode: "intent" as const,
      previousActions: ["以前からの活動"],
    },
  ];
  const intentions = {
    [npc]: { actorId: npc, actionText: "返事を待つ", continuing: true },
  };
  const agenda = sceneAgenda(
    old,
    actor,
    1000,
    {
      type: "propose",
      summary: "",
      resolvedUntil: 1000,
      changes: { nodes: [], edges: [], revisions: [], endEdges: [] },
      deferredIntentions: [npc],
      wakeups: [],
    },
    intentions,
    [other],
  );
  expect(agenda[0]?.at).toBe(1000);
  expect(agenda[0]?.id).not.toBe(oldId);
  expect(agenda[0]?.previousActions).toEqual(["以前からの活動", "返事を待つ"]);
  expect(agenda.some((w) => w.actorId === other && w.mode === "intent")).toBe(
    true,
  );
  expect(old[0]?.at).toBe(0);
  expect(old[0]?.previousActions).toEqual(["以前からの活動"]);
});

test("入力完了後に終了してもNPCの判定待ちと途中の活動をagendaへ引き継ぐ", () => {
  const unrelated = randomUUID();
  const original = [
    {
      id: randomUUID(),
      at: 0,
      actorId: npc,
      mode: "resolve" as const,
      actionText: "途中の活動",
    },
    { id: randomUUID(), at: 2000, actorId: unrelated, mode: "intent" as const },
  ];
  const next = sceneAgenda(
    original,
    actor,
    1000,
    {
      type: "propose",
      summary: "",
      resolvedUntil: 1000,
      changes: { nodes: [], edges: [], revisions: [], endEdges: [] },
      settledIntentions: [
        { actorId: actor, reason: "礼を述べる入力が成立した" },
      ],
      deferredIntentions: [npc],
      wakeups: [],
    },
    {
      [npc]: { actorId: npc, actionText: "本人の返事を待つ", continuing: true },
    },
    [npc],
  );
  expect(next.find((w) => w.actorId === npc)).toMatchObject({
    at: 1000,
    mode: "intent",
    previousActions: ["途中の活動\n\n本人の返事を待つ", "本人の返事を待つ"],
  });
  expect(next.find((w) => w.actorId === unrelated)).toEqual(original[1]);
  expect(original[0]?.actionText).toBe("途中の活動");
});

test("登場NPCの選択済みの継続と新しい判断を引き継ぎ、人間・範囲外・未来・期間方針は実行しない", () => {
  const result = sceneContinuations(
    [
      {
        id: "1",
        actorId: "npc",
        at: 1,
        mode: "resolve",
        actionText: "選択済みの案内の残り",
      },
      { id: "2", actorId: "deciding", at: 1, mode: "intent" },
      {
        id: "3",
        actorId: "actor",
        at: 1,
        mode: "resolve",
        actionText: "本人の以前の意図",
      },
      {
        id: "4",
        actorId: "remote",
        at: 1,
        mode: "resolve",
        actionText: "範囲外",
      },
      { id: "5", actorId: "future", at: 2, mode: "intent" },
      {
        id: "6",
        actorId: "policy",
        at: 1,
        mode: "resolve",
        planUntil: 10,
        actionText: "構築の期間方針",
      },
      {
        id: "7",
        actorId: "waiting",
        at: 1,
        mode: "resolve",
        deferred: true,
        actionText: "次の契機を待つ意図",
      },
    ],
    ["npc", "deciding", "actor", "future", "policy", "waiting"],
    "actor",
    1,
  );
  expect(result).toEqual({
    pending: {
      npc: {
        actorId: "npc",
        actionText: "選択済みの案内の残り",
        continuing: true,
      },
    },
    nextDecisions: ["deciding"],
  });
});

test("説明の予告や複合質問の欠落があれば操作を返さず、発話者の次の判断を求める", () => {
  const make = (
    outcome: "delivered" | "declined" | "pending",
    quote: string,
  ) => ({
    type: "scene",
    events: [
      {
        actorId: npc,
        text: quote,
        receipts: [{ observerId: actor, text: quote }],
      },
    ],
    decisions: { [actor]: "finished", [npc]: "finished" },
    newDecisions: [actor],
    elapsedMs: 0,
    responseCoverage: [
      {
        requestPart: "手順と注意点を聞く",
        outcome,
        evidence: [{ eventIndex: 0, receiptIndex: 0, quote }],
        explanation: "提示内容を照合",
      },
    ],
  });
  const deferred = sceneResponse(
    make("pending", "注意点から話そう"),
    actor,
    "手順と注意点を聞く",
  );
  expect(deferred).toMatchObject({
    decisions: { [actor]: "pending", [npc]: "decide" },
    newDecisions: [],
  });
  for (const outcome of ["delivered", "declined"] as const) {
    const complete = sceneResponse(
      make(
        outcome,
        outcome === "delivered"
          ? "籠を先に洗う。赤い葉には触らない"
          : "今は患者の処置中なので説明できない",
      ),
      actor,
      "手順と注意点を聞く",
    );
    expect(complete.type === "scene" && complete.decisions[actor]).toBe(
      "finished",
    );
  }
  const partial = make("delivered", "籠を洗う");
  partial.responseCoverage.push({
    requestPart: "注意点",
    outcome: "pending",
    evidence: [],
    explanation: "注意点が届いていない",
  });
  expect(sceneResponse(partial, actor, "手順と注意点を聞く")).toMatchObject({
    decisions: { [actor]: "pending" },
  });
  const asked = make("delivered", "質問は村人へ届いた");
  asked.events[0]!.actorId = actor;
  asked.events[0]!.receipts[0]!.observerId = npc;
  asked.decisions[actor] = "pending";
  asked.newDecisions = [npc];
  asked.responseCoverage.push({
    requestPart: "注意点",
    outcome: "pending",
    evidence: [],
    explanation: "相手の返答を待っている",
  });
  expect(sceneResponse(asked, actor, "手順と注意点を聞く")).toMatchObject({
    decisions: { [actor]: "pending" },
    newDecisions: [npc],
  });
  const wrong = make("delivered", "本人へ返した内容");
  wrong.events[0]!.receipts[0]!.observerId = npc;
  expect(() => sceneResponse(wrong, actor, "手順と注意点を聞く")).toThrow(
    "本人向け提示",
  );
  const legacy = make("delivered", "以前の提示");
  const { responseCoverage: _coverage, ...old } = legacy;
  void _coverage;
  expect(() => sceneResponse(old, actor, "手順と注意点を聞く")).toThrow();
  expect(sceneResponse(old, actor, "手順と注意点を聞く", false)).toMatchObject({
    decisions: old.decisions,
  });
});

test("同じ入力で前段に届いた説明を参照し、別入力の履歴を回答へ流用しない", () => {
  const inputId = randomUUID(),
    past = {
      id: randomUUID(),
      inputId,
      actorId: npc,
      text: "先に道具を伝えた",
      period: { from: 0, until: 1 },
      receipts: [{ observerId: actor, text: "木の籠を使ってください" }],
    };
  const value = {
    type: "scene",
    events: [
      {
        actorId: npc,
        text: "注意を伝えた",
        receipts: [{ observerId: actor, text: "赤い葉には触れないでください" }],
      },
    ],
    decisions: { [actor]: "finished", [npc]: "finished" },
    newDecisions: [],
    elapsedMs: 0,
    responseCoverage: [
      {
        requestPart: "使う道具",
        outcome: "delivered",
        evidence: [{ source: "history", eventIndex: 0, receiptIndex: 0 }],
        explanation: "前段で聞いた道具",
      },
      {
        requestPart: "扱いの注意",
        outcome: "delivered",
        evidence: [{ source: "events", eventIndex: 0, receiptIndex: 0 }],
        explanation: "今回聞いた注意",
      },
    ],
  };
  expect(sceneResponse(value, actor, inputId, true, [past])).toMatchObject({
    decisions: { [actor]: "finished" },
  });
  expect(() => sceneResponse(value, actor, randomUUID(), true, [past])).toThrow(
    "本人向け提示",
  );
  value.responseCoverage[1]!.evidence[0]!.eventIndex = 7;
  expect(() => sceneResponse(value, actor, inputId, true, [past])).toThrow(
    "本人向け提示",
  );
});

test("既存の声を後から加わったNPCへ届け、発言や既存受容を繰り返さない", () => {
  const history = [
    {
      id: randomUUID(),
      inputId: randomUUID(),
      actorId: actor,
      text: "手順を尋ねた",
      period: { from: 0, until: 0 },
      receipts: [{ observerId: actor, text: "手順を尋ね、返事を待っている" }],
    },
  ];
  const arrival = {
    eventIndex: 0,
    observerId: npc,
    text: "手順と注意点を教えてほしいという声が届いた",
  };
  expect(sceneArrivals(history, [arrival], bg.participants, actor, 0)).toEqual([
    npc,
  ]);
  expect(history).toHaveLength(1);
  expect(history[0]!.receipts[0]!.text).toBe("手順を尋ね、返事を待っている");
  const view = sceneView(
    { observerId: npc, at: 0, observations: [], interpretations: [] },
    bg,
    history,
    [],
    0,
  );
  expect(JSON.stringify(view.observations)).toContain(arrival.text);
  expect(
    sceneArrivals(
      history,
      [{ ...arrival, text: "別の内容へ変更" }],
      bg.participants,
      actor,
      0,
    ),
  ).toEqual([]);
  expect(history[0]!.receipts[1]!.text).toBe(arrival.text);
  const untouched = structuredClone(history);
  expect(() =>
    sceneArrivals(
      history,
      [{ ...arrival, observerId: place }],
      bg.participants,
      actor,
      0,
    ),
  ).toThrow("受容者");
  expect(() =>
    sceneArrivals(
      history,
      [{ ...arrival, observerId: actor }],
      bg.participants,
      actor,
      0,
    ),
  ).toThrow("受容者");
  expect(() =>
    sceneArrivals(
      history,
      [{ ...arrival, eventIndex: 7 }],
      bg.participants,
      actor,
      0,
    ),
  ).toThrow("参照先");
  expect(history).toEqual(untouched);
});
