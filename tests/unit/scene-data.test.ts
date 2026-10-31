import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { Change } from "../../packages/server/src/world/model.js";
import {
  mergeSceneChanges,
  sceneAgenda,
  sceneContinuations,
  sceneAnchors,
  sceneView,
  sceneResponse,
  legacyCoverageFailure,
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
    {
      observerId: npc,
      at: 0,
      observations: [],
      interpretations: [],
      conditions: [],
    },
    bg,
    events,
    ["本人の継続"],
    1000,
  );
  expect(view.at).toBe(1000);
  expect(view.observations[0]?.period).toEqual({ from: 0, until: 1000 });
  expect(view.ownIntentions).toEqual(["本人の継続"]);
});
test("途中で変わった状態を実際の時点で閉じ、content/aboutと旧終了指定を同期する", () => {
  const anchors = sceneAnchors(
      {
        ...bg,
        facts: [{ subjectId: npc, text: "状態A", aboutIds: [place] }],
      },
      [],
      0,
      randomUUID(),
    ),
    original = structuredClone(anchors),
    state = anchors.edges.find(
      (e) => e.kind === "status" && e.role === "content",
    )!,
    about = anchors.edges.find(
      (e) => e.kind === "status" && e.role === "about",
    )!,
    next = { id: randomUUID(), kind: "script" as const, text: "状態B" },
    nextContent = {
      ...state,
      id: randomUUID(),
      target: next.id,
      period: { from: 500 },
    },
    nextAbout = {
      ...about,
      id: randomUUID(),
      source: next.id,
      period: { from: 500 },
    };
  const result = mergeSceneChanges(
    anchors,
    {
      nodes: [next],
      revisions: [],
      edges: [
        { ...state, period: { ...state.period, until: 500 } },
        nextContent,
        nextAbout,
      ],
      endEdges: [about.id],
    },
    1000,
  );
  const statesAt = (at: number) =>
    result.edges
      .filter(
        (e) =>
          e.kind === "status" &&
          e.role === "content" &&
          e.period.from <= at &&
          (e.period.until === undefined || at < e.period.until),
      )
      .map((e) => e.target);
  expect(statesAt(499)).toEqual([state.target]);
  expect(statesAt(500)).toEqual([next.id]);
  expect(statesAt(750)).toEqual([next.id]);
  expect(result.edges.find((e) => e.id === about.id)?.period.until).toBe(500);
  expect(result.edges).toHaveLength(anchors.edges.length + 2);
  expect(new Set(result.edges.map((e) => e.id)).size).toBe(result.edges.length);
  expect(result.endEdges).toEqual([]);
  expect(anchors).toEqual(original);
  const paired = mergeSceneChanges(
    anchors,
    {
      nodes: [],
      revisions: [],
      edges: [state, about].map((e) => ({
        ...e,
        period: { ...e.period, until: 500 },
      })),
      endEdges: [],
    },
    1000,
  );
  expect(paired.edges.every((e) => e.period.until === 500)).toBe(true);
});
test("状態終了は属性の改変・未到達時点・相反する終点を受け付けない", () => {
  const anchors = sceneAnchors(bg, events, 100, randomUUID()),
    state = anchors.edges.find(
      (e) => e.kind === "status" && e.role === "content",
    )!,
    about = anchors.edges.find(
      (e) => e.kind === "status" && e.role === "about",
    )!,
    see = anchors.edges.find((e) => e.kind === "see")!,
    ending = { ...state, period: { ...state.period, until: 500 } };
  for (const changed of [
    { ...ending, text: "別の内容" },
    { ...ending, source: actor },
    { ...ending, period: { from: 101, until: 500 } },
    { ...ending, period: { ...state.period, until: 1001 } },
    state,
    { ...see, period: { ...see.period, until: 500 } },
  ])
    expect(() =>
      mergeSceneChanges(
        anchors,
        { nodes: [], revisions: [], edges: [changed], endEdges: [] },
        1000,
      ),
    ).toThrow("改訂");
  expect(() =>
    mergeSceneChanges(
      anchors,
      {
        nodes: [],
        revisions: [],
        edges: [ending, { ...about, period: { ...about.period, until: 600 } }],
        endEdges: [],
      },
      1000,
    ),
  ).toThrow("異なる終了時点");
  const laterAbout = {
    ...anchors,
    edges: anchors.edges.map((e) =>
      e.id === about.id ? { ...e, period: { from: 600 } } : e,
    ),
  };
  expect(() =>
    mergeSceneChanges(
      laterAbout,
      { nodes: [], revisions: [], edges: [ending], endEdges: [] },
      1000,
    ),
  ).toThrow("終点");
  expect(() =>
    Change.parse({
      nodes: [],
      edges: [ending],
      endEdges: [state.id],
    }),
  ).toThrow("重複");
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
    expect(sceneResponse(value)).toEqual(expected);
    expect(value).toEqual(original);
  },
);

test("旧保存出力の診断フィールドだけを捨て、出来事・到着受容・判断先は変えない", () => {
  const obsolete = {
    code: "invalid_type",
    path: ["responseCoverage", 0, "explanation"],
    message: "旧診断の説明がない",
  };
  expect(legacyCoverageFailure(JSON.stringify([obsolete]))).toBe(true);
  expect(
    legacyCoverageFailure(
      JSON.stringify([
        obsolete,
        { ...obsolete, path: ["events", 0, "actorId"] },
      ]),
    ),
  ).toBe(false);
  expect(legacyCoverageFailure("行動主体が不正です")).toBe(false);
  const value = {
    type: "scene",
    events: [
      {
        actorId: npc,
        text: "本人が選んだ発言",
        receipts: [{ observerId: actor, text: "本人の発言が届いた" }],
      },
    ],
    decisions: { [actor]: "decide", [npc]: "pending" },
    newDecisions: [npc],
    arrivals: [{ eventIndex: 0, observerId: npc, text: "前の声が届いた" }],
    elapsedMs: 0,
    responseCoverage: [
      {
        requestPart: "未回答の問い",
        outcome: "pending",
        evidence: [],
      },
    ],
  };
  const original = structuredClone(value);
  const { responseCoverage: _coverage, ...expected } = value;
  void _coverage;
  expect(sceneResponse(value)).toEqual(expected);
  const { arrivals: _arrivals, ...withoutArrivals } = expected;
  void _arrivals;
  expect(sceneResponse(withoutArrivals)).toEqual({
    ...withoutArrivals,
    arrivals: [],
  });
  expect(value).toEqual(original);
  expect(() => sceneResponse({ ...expected, elapsedMs: -1 })).toThrow();
  expect(() =>
    sceneResponse({ ...expected, events: [{ actorId: "invalid" }] }),
  ).toThrow();
  expect(() =>
    sceneResponse({ ...expected, decisions: { [actor]: "unknown" } }),
  ).toThrow();
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
      [{ ...arrival, eventIndex: 7 }],
      bg.participants,
      actor,
      0,
    ),
  ).toThrow("参照先");
  expect(history).toEqual(untouched);
});
