import {
  InspectionManifest,
  type Information,
  type Presentation,
} from "@gestaloka/contracts";
import { sceneId } from "../../packages/server/src/runtime/scene-data.js";
import { digest } from "../../packages/server/src/inspection/store.js";

export const fid = (name: string) => sceneId(`inspection-fixture:${name}`);
export const info = (
  id: string,
  state: string,
  changes: Partial<Information> = {},
): Information => ({
  kind: "node",
  id: fid(id),
  aspect: "状態",
  state,
  version: "1",
  at: 0,
  origin: "generated",
  evidence: state,
  ...changes,
});
export function presentation(
  name: string,
  text: string,
  information: Information[] | null,
  input: string | null = name,
): Presentation {
  return {
    id: fid(`presentation:${name}`),
    sceneId: fid("scene"),
    inputId: input ? fid(input) : null,
    kind: input ? "response" : "synopsis",
    ordinal: 0,
    text,
    at: 0,
    providedAt: "2026-10-28T00:00:01.000Z",
    information,
  };
}
export function inspectionFixture() {
  const prior = presentation(
    "prior",
    "扉が閉まっている。村人は姉について話していた。",
    [info("door", "閉じている"), info("villager", "姉についての証言")],
    null,
  );
  const cases = [
    {
      name: "echo",
      input: "扉に手をかける。",
      text: "扉に手をかけます。",
      information: [],
    },
    {
      name: "success",
      input: "扉を開ける。",
      text: "扉は開いた。",
      information: [info("door", "開いている", { at: 1 })],
    },
    {
      name: "refusal",
      input: "橋を渡ってよいか聞く。",
      text: "村人は「橋板が腐っているから渡せない」と答えた。",
      information: [info("refusal", "橋板が腐っている")],
    },
    {
      name: "relationship",
      input: "姉をどう思っているか聞く。",
      text: "村人は姉に救われたことを打ち明け、声を震わせた。",
      information: [info("villager", "姉に救われた", { aspect: "姉との関係" })],
    },
    {
      name: "mystery",
      input: "机の上を調べる。",
      text: "机に、誰のものか分からない三つ目の封印がある。",
      information: [info("seal", "第三の封印がある")],
    },
    {
      name: "certainty",
      input: "姉の署名を見比べる。",
      text: "手紙の署名は姉の筆跡と一致した。",
      information: [
        info("villager", "姉の証言が署名で裏付けられた", { at: 2 }),
      ],
    },
    {
      name: "internal",
      input: "しばらく待つ。",
      text: "時間が過ぎる。",
      information: [],
    },
    {
      name: "takeover",
      input: "提案を聞く。まだ同意しない。",
      text: "あなたは提案に同意し、契約に署名した。",
      information: [info("contract", "契約への署名が成立")],
    },
    {
      name: "synonym",
      input: "橋の事情を確かめる。",
      text: "橋板が傷んでいるため通行できないとの返事だった。",
      information: [info("different-refusal-id", "橋板の腐食で通行拒否")],
    },
  ];
  const inputs = cases.map((c) => ({
    id: fid(c.name),
    text: c.input,
    state: "complete",
    submittedAt: "2026-10-28T00:00:00.000Z",
    completedAt: "2026-10-28T00:00:01.000Z",
  }));
  const presentations = cases.map((c, i) => ({
    ...presentation(c.name, c.text, c.information),
    ordinal: i,
  }));
  const body = {
    recordVersion: "inspection-record-v2",
    initial: [],
    capturedAt: "2026-10-28T00:00:02.000Z",
    selection: {
      worldId: fid("world"),
      userId: fid("user"),
      actorId: fid("actor"),
      endSceneId: fid("scene"),
      n: 1,
    },
    requestedScenes: 1,
    actualScenes: 1,
    prior: [prior],
    priorMissingScenes: [],
    scenes: [
      {
        id: fid("scene"),
        revision: "fixture-v1",
        state: "result",
        createdAt: "2026-10-28T00:00:00.000Z",
        inputs,
        presentations,
        calls: [
          {
            id: fid("call"),
            responseId: fid("success"),
            model: "fixture-model",
            configurationVersion: 1,
            task: "scene-resolve",
            status: "complete:complete",
            nanoUsd: "1000000",
            reservedNanoUsd: "2000000",
            elapsedMs: 100,
            inputTokens: 100,
            outputTokens: 100,
          },
        ],
        administratorEvidence: {
          background: null,
          events: [
            {
              id: fid("internal-update"),
              text: "NPCだけが秘密の地下道を発見した。プレイヤーへは提示されていない。",
            },
          ],
          dependencies: [],
          projection: null,
        },
        recording: "recorded",
      },
    ],
  };
  return InspectionManifest.parse({ ...body, id: digest(body) });
}
