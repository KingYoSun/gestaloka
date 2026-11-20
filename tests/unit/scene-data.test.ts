import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import {
  sceneAgenda,
  sceneContinuations,
  sceneAnchors,
  remainingQuestions,
  SceneContext,
  sceneView,
  sceneResponse,
  sceneRepairConclusion,
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
    locations: [{ subjectId: actor, text: "道端", aboutIds: [place] }],
  },
];

test.each([false, true, undefined])(
  "終了判定%jを受理し、形式修復では同じ判定を保つ",
  (concluded) => {
    const event = {
      actorId: actor,
      text: events[0]!.text,
      receipts: events[0]!.receipts,
      locations: events[0]!.locations,
    };
    const original = {
      type: "scene",
      decisions: { [actor]: "finished" },
      events: [event],
      ...(concluded === undefined ? {} : { concluded }),
    };
    expect(sceneResponse(original)).toMatchObject({
      type: "scene",
      ...(concluded === undefined ? {} : { concluded }),
    });
    const messages = [
      { role: "assistant", content: "{" },
      {
        role: "assistant",
        content: JSON.stringify({ type: "query", requests: [] }),
      },
      { role: "assistant", content: JSON.stringify(original) },
      {
        role: "assistant",
        content: JSON.stringify({ type: "query", requests: [] }),
      },
      {
        role: "assistant",
        content: JSON.stringify({ ...original, concluded: !concluded }),
      },
    ];
    const fixed = sceneRepairConclusion(messages);
    expect(fixed).toBe(concluded ?? false);
    expect(() =>
      sceneResponse({ ...original, concluded: !fixed }, false, [], [], fixed),
    ).toThrow("終了判定");
    expect(sceneResponse(original, false, [], [], fixed)).toMatchObject({
      type: "scene",
    });
  },
);
test("別の対象の状態では問いを閉じず、同じ対象の照会と回答がそろえば閉じる", () => {
  const q = { question: "探している資料の署名は何か", targetId: place };
  const background = { ...bg, unknowns: [q] };
  const answer = SceneContext.parse({
    type: "context",
    participants: [],
    facts: [{ subjectId: npc, aboutIds: [place], text: "署名は星形" }],
    resolvedUnknowns: [{ question: q.question, factIndex: 0 }],
  });
  expect(remainingQuestions(background, answer, new Set([npc, place]))).toEqual(
    [q],
  );
  answer.facts[0]!.subjectId = place;
  expect(remainingQuestions(background, answer, new Set([npc]))).toEqual([q]);
  expect(remainingQuestions(background, answer, new Set([place]))).toEqual([]);
});
test("確定済みの所在地を終了時に再発行せず、出来事の本文を保つ", () => {
  const background = {
    ...bg,
    creations: [{ id: npc, text: "人物" }],
    facts: [
      { subjectId: actor, text: "戸口", aboutIds: [place], location: true },
      ...bg.facts,
    ],
  };
  const anchors = sceneAnchors(background, events, 0, randomUUID(), true);
  expect(anchors.nodes.some((n) => n.text === "戸口")).toBe(false);
  expect(anchors.nodes.find((n) => n.id === event)?.text).toBe(events[0]!.text);
});
test("行動主体の所在地を省略した新しい行動解決を受理しない", () => {
  const base = {
    type: "scene",
    events: [{ actorId: actor, text: "歩いた", receipts: [] }],
    decisions: { [actor]: "finished" },
    newDecisions: [],
  };
  expect(() => sceneResponse(base)).toThrow();
  expect(() =>
    sceneResponse({ ...base, events: [{ ...base.events[0], locations: [] }] }),
  ).toThrow();
  expect(() =>
    sceneResponse({
      ...base,
      events: [
        {
          ...base.events[0],
          locations: [{ subjectId: npc, text: "外", aboutIds: [place] }],
        },
      ],
    }),
  ).toThrow("行動主体");
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

test.each(["decide", "finished"] as const)(
  "NPCの部分返答でもモデルが返した本人の%sとNPCの継続待ちを保持する",
  (decision) => {
    const value = {
      type: "scene",
      events: [
        {
          actorId: npc,
          text: "問いの一部にだけ答えた",
          locations: [{ subjectId: npc, text: "道端", aboutIds: [place] }],
          receipts: [{ observerId: actor, text: "一つ目について話した" }],
        },
      ],
      decisions: { [actor]: decision, [npc]: "pending" },
      newDecisions: [],
      arrivals: [],
      elapsedMs: 0,
      responseCoverage: [
        {
          requestPart: "一つ目の問い",
          outcome: "delivered",
          evidence: [{ eventIndex: 0, receiptIndex: 0 }],
          explanation: "一つ目は返答した",
        },
        {
          requestPart: "もう一つの問い",
          outcome: "pending",
          evidence: [],
          explanation: "この部分には答えていない",
        },
      ],
    };
    const original = structuredClone(value);
    const { responseCoverage: _coverage, ...expected } = value;
    void _coverage;
    expect(sceneResponse(value, true, events)).toMatchObject({
      ...expected,
      decisions: {
        ...expected.decisions,
        [npc]: { pending: "選んだ行為の未実行部分を続ける" },
      },
      arrivals: [],
      departures: [],
    });
    expect(value).toEqual(original);
  },
);

test("旧保存出力は境界で受容契約へ変換し、新しいモデル出力には旧配送欄を認めない", () => {
  const legacy = {
    type: "scene",
    events: [
      {
        actorId: actor,
        text: "声をかけた",
        locations: [{ subjectId: actor, text: "道端", aboutIds: [place] }],
        receipts: [],
      },
    ],
    callsToPlayers: [
      {
        eventIndex: 0,
        observerId: npc,
        positionRelationId: randomUUID(),
        text: "声が届いた",
      },
    ],
    decisions: { [actor]: "pending" },
    newDecisions: [],
    responseCoverage: [],
  };
  const parsed = sceneResponse(legacy, true);
  expect(parsed.type).toBe("scene");
  if (parsed.type !== "scene") throw Error("scene");
  expect(parsed.events[0]!.receipts).toEqual([
    { observerId: npc, text: "声が届いた" },
  ]);
  expect(parsed.decisions[actor]).toEqual({
    pending: "選んだ行為の未実行部分を続ける",
    waitingFor: [],
  });
  expect(() => sceneResponse(legacy)).toThrow();
  expect(legacy.callsToPlayers).toHaveLength(1);
});

test("本人条件を観測や自己解釈と分離し、背景の他者条件を本人へ混ぜない", () => {
  const base = {
    observerId: npc,
    at: 0,
    conditions: [{ text: "SELF_DISPOSITION", about: [npc], at: 0 }],
    observations: [],
    interpretations: [{ text: "SELF_BELIEF", about: [place] }],
  };
  const background = {
    ...bg,
    facts: [
      { subjectId: npc, text: "SELF_COGNITION", aboutIds: [place], at: 500 },
      { subjectId: actor, text: "OTHER_PRIVATE_CONDITION", aboutIds: [] },
    ],
  };
  const view = sceneView(base, background, [], [], 1000);
  expect(view.conditions).toEqual([
    ...base.conditions,
    { text: "SELF_COGNITION", about: [place], at: 500 },
  ]);
  expect(view.observations).toEqual([]);
  expect(view.interpretations).toEqual(base.interpretations);
  expect(JSON.stringify(view)).not.toContain("OTHER_PRIVATE_CONDITION");
  expect(base.conditions).toEqual([
    { text: "SELF_DISPOSITION", about: [npc], at: 0 },
  ]);
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
    eventId: history[0]!.id,
    observerId: npc,
    text: "手順と注意点を教えてほしいという声が届いた",
  };
  expect(sceneArrivals(history, [arrival], bg.participants, actor, 0)).toEqual([
    npc,
  ]);
  expect(history).toHaveLength(1);
  expect(history[0]!.receipts[0]!.text).toBe("手順を尋ね、返事を待っている");
  const view = sceneView(
    {
      observerId: npc,
      at: 0,
      observations: [],
      interpretations: [],
      conditions: [],
    },
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
      [{ ...arrival, eventId: randomUUID() }],
      bg.participants,
      actor,
      0,
    ),
  ).toThrow("参照先");
  expect(history).toEqual(untouched);
});
