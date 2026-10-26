import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import {
  mergeSceneChanges,
  sceneAgenda,
  sceneAnchors,
  sceneView,
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
