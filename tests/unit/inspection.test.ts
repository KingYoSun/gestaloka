import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { InspectionManifest } from "@gestaloka/contracts";
import { measure } from "../../packages/server/src/inspection/measure.js";
import { summarizeHistory } from "../../packages/server/src/inspection/history.js";
import { recordPresentations } from "../../packages/server/src/inspection/record.js";
import { validateAssessment } from "../../packages/server/src/inspection/evaluate.js";
import {
  fid,
  info,
  inspectionFixture,
  presentation,
} from "../fixtures/inspection.js";
import type { SceneRow } from "../../packages/server/src/runtime/scene.js";
import {
  sceneAnchors,
  SceneBackground,
} from "../../packages/server/src/runtime/scene-data.js";

test("固定manifestから同じ分類・値を返し、窓前の状態、別側面、更新、内部情報を区別する", () => {
  const manifest = inspectionFixture(),
    result = measure(manifest);
  expect(measure(structuredClone(manifest))).toEqual(result);
  expect(result.total.counts).toEqual({
    node: 4,
    edge: 0,
    aspect: 1,
    update: 2,
  });
  expect(result.total.value).toBe(7);
  expect(
    result.scenes[0]!.inputs.find((i) => i.id === fid("internal"))!.value,
  ).toBe(0);
  expect(result.total.calculatedNanoUsd).toBe("1000000");
  expect(result.total.modelCallMs).toBe(100);
  expect(result.total.responseWaitMs).toBe(9000);
  expect(result.longestLowRun).toBe(1);
});

test("期間集計は指標・モデル設定の異なる窓を別系列にする", () => {
  const m = inspectionFixture(),
    measurement = measure(m),
    source = m.scenes.map((s) => ({
      id: s.id,
      inputs: s.inputs.map((i) => i.id),
      calls: s.calls,
    }));
  const row = {
    id: m.id,
    at: new Date(m.capturedAt),
    selection: m.selection,
    measurement,
    sources: source,
    evaluations: [],
  };
  const result = summarizeHistory([
    row,
    {
      ...row,
      id: "other-metric",
      selection: { ...row.selection, metricVersion: "presentation-v0" },
      measurement: { ...measurement, metricVersion: "presentation-v0" },
    },
    {
      ...row,
      id: "other-model",
      sources: source.map((s) => ({
        ...s,
        calls: s.calls.map((c) => ({ ...c, configurationVersion: 2 })),
      })),
    },
  ]);
  expect(result).toHaveLength(3);
  expect(result.every((s) => s.uniqueInputs === 9 && s.uniqueCalls === 1)).toBe(
    true,
  );
});
test("同一要素・側面・状態の再表示は加点せず、ノードとエッジを排他的に数える", () => {
  const m = inspectionFixture(),
    s = m.scenes[0]!;
  const r = info("door", "閉じている");
  s.presentations = [
    presentation("repeat", "扉は閉じている", [r, r]),
    presentation("edge", "扉との接続", [
      info("edge", "接続", { kind: "edge", origin: "reference" }),
    ]),
  ];
  const a = measure(m);
  expect(a.total.counts).toEqual({ node: 0, edge: 1, aspect: 0, update: 0 });
  expect(a.total.origins).toEqual({ reference: 1, generated: 0 });
  m.selection.weights = {
    version: "edge-two",
    values: { node: 1, edge: 2, aspect: 1, update: 1 },
    rationale: "fixture用固定重み",
  };
  expect(measure(m).total.value).toBe(2);
});
test("未記録、旧記録、途中、保留、件数不足、費用・時間不足を0点へ変換しない", () => {
  const m = inspectionFixture();
  m.requestedScenes = 3;
  const s = m.scenes[0]!;
  s.state = "paused";
  s.recording = "legacy";
  s.calls = [];
  s.presentations[0]!.information = null;
  s.inputs[0]!.completedAt = null;
  m.priorMissingScenes = [fid("old")];
  const r = measure(m);
  expect(r.requestedScenes).toBe(3);
  expect(r.actualScenes).toBe(1);
  expect(r.status).toBe("partial");
  expect(r.total.value).toBeNull();
  expect(r.total.calculatedNanoUsd).toBeNull();
  expect(r.total.modelCallMs).toBeNull();
  expect(r.total.responseWaitMs).toBeNull();
  expect(r.total.coverage.ratio).toBeLessThan(1);
});
test("本人向け提示の記録は再保存で増えず、終了時のグラフと同じIDを使う", () => {
  const bg = SceneBackground.parse({
    type: "background",
    synopsis: "扉がある",
    participants: [fid("actor"), fid("npc")],
    facts: [],
    perceptions: [],
    unknowns: [],
    synopsisInformation: [],
  });
  const row = {
    id: fid("scene"),
    actor_id: fid("actor"),
    state: "active",
    data: {
      recordingVersion: "inspection-record-v1",
      background: bg,
      startedAt: 0,
      at: 0,
      actions: [{ id: fid("act"), state: "complete" }],
      events: [
        {
          id: fid("event"),
          actorId: fid("actor"),
          inputId: fid("act"),
          text: "扉を開いた",
          period: { from: 0, until: 0 },
          receipts: [
            {
              observerId: fid("actor"),
              text: "扉が開いた",
              information: [
                info("unused", "開いた", { id: "$event" }),
                info("unused", "受容した", {
                  id: "$receipt",
                  kind: "edge",
                  evidence: "扉が開いた",
                }),
              ],
            },
            { observerId: fid("npc"), text: "NPCだけの秘密", information: [] },
          ],
        },
      ],
    },
  } as unknown as SceneRow;
  recordPresentations(row);
  recordPresentations(row);
  expect(row.data.presentations).toHaveLength(2);
  expect(JSON.stringify(row.data.presentations)).not.toContain("NPCだけの秘密");
  const anchors = sceneAnchors(bg, row.data.events, 0, row.id),
    p = row.data.presentations![1]!;
  expect(anchors.nodes.some((n) => n.id === p.information![0]!.id)).toBe(true);
  expect(anchors.edges.some((e) => e.id === p.information![1]!.id)).toBe(true);
  row.data.presentations = [];
  row.data.events[0]!.receipts[0]!.information![0]!.evidence =
    "提示していない引用";
  recordPresentations(row);
  expect(row.data.presentations[1]!.information).toBeNull();
});
test("意味評価の引用と入力の対応を検証し、原則違反を情報量で相殺させない", () => {
  const m = inspectionFixture(),
    base = {
      inputs: m.scenes[0]!.inputs.map((a) => ({
        inputId: a.id,
        units: [],
        responsiveness: "unknown",
        principle: "unknown",
        principleEvidence: [],
        missing: ["fixture"],
      })),
      overall: {
        newInformation: null,
        importance: null,
        responsiveness: "不足",
        stagnation: "不明",
        principle: "unknown",
        explanation: "不足",
        missing: ["fixture"],
      },
      disagreements: [],
    };
  expect(validateAssessment(base, m).overall.newInformation).toBeNull();
  const priorEvidence = {
    presentationId: m.prior[0]!.id,
    quote: "扉が閉まっている。",
    explanation: "入力前の前提",
  };
  const priorAssessment = {
    ...base,
    inputs: base.inputs.map((a, i) => ({
      ...a,
      principleEvidence: i === 0 ? [priorEvidence] : [],
    })),
  };
  expect(
    validateAssessment(priorAssessment, m).inputs[0]!.principleEvidence,
  ).toHaveLength(1);
  const futureAssessment = {
    ...priorAssessment,
    inputs: priorAssessment.inputs.map((a, i) => ({
      ...a,
      principleEvidence:
        i === 0
          ? [
              {
                ...priorEvidence,
                presentationId: m.scenes[0]!.presentations.at(-1)!.id,
                quote: m.scenes[0]!.presentations.at(-1)!.text,
              },
            ]
          : [],
    })),
  };
  expect(() => validateAssessment(futureAssessment, m)).toThrow("後日の提示");
  expect(() =>
    validateAssessment(
      {
        ...base,
        disagreements: [
          { presentationId: fid("absent"), explanation: "根拠なし" },
        ],
      },
      m,
    ),
  ).toThrow("参照先");
});

test("実モデルの保存済み評価が必要な区別・根拠・不足を記録している", async () => {
  const record = JSON.parse(
    await readFile(
      new URL(
        "../../documents/evaluations/narrative-inspection-fixture-2026-10-28.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const manifest = InspectionManifest.parse(record.manifest),
    result = validateAssessment(record.evaluation.assessment, manifest);
  const input = (name: string) =>
    result.inputs.find((i) => i.inputId === fid(name))!;
  expect(input("echo").units.every((u) => u.category === "duplicate")).toBe(
    true,
  );
  for (const name of ["success", "refusal", "relationship", "mystery"])
    expect(input(name).units.some((u) => u.category !== "duplicate")).toBe(
      true,
    );
  expect(input("certainty").units.some((u) => u.category === "certainty")).toBe(
    true,
  );
  expect(
    JSON.stringify(
      result.inputs.flatMap((i) =>
        i.units.filter((u) => u.category !== "duplicate"),
      ),
    ),
  ).not.toContain("地下道を発見した");
  expect(input("takeover").principle).toBe("violation");
  expect(result.overall.principle).toBe("violation");
  expect(input("synonym").units.every((u) => u.category === "duplicate")).toBe(
    true,
  );
  expect(
    result.disagreements.some(
      (d) => d.presentationId === manifest.scenes[0]!.presentations.at(-1)!.id,
    ),
  ).toBe(true);
  expect(result.overall.missing.length).toBeGreaterThan(0);
});
