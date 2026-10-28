import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { InspectionManifest } from "@gestaloka/contracts";
import { measure } from "../../packages/server/src/inspection/measure.js";
import { summarizeHistory } from "../../packages/server/src/inspection/history.js";
import {
  canonicalInformation,
  recordPresentations,
} from "../../packages/server/src/inspection/record.js";
import {
  validateAssessment,
  inspectionItem,
  quoteSources,
} from "../../packages/server/src/inspection/evaluate.js";
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
  presentationEvidence,
} from "../../packages/server/src/runtime/scene-data.js";

test("正本の構造参照は言い換えと要約で増えず、実際の内容変更だけ更新になる", () => {
  const m = inspectionFixture(),
    s = m.scenes[0]!;
  m.selection.metricVersion = "presentation-v3";
  m.prior = [];
  const first = canonicalInformation(
    { id: fid("door"), kind: "script", text: "閉じている" },
    "reference",
    "扉は閉じている",
  );
  const changed = canonicalInformation(
    { id: fid("door"), kind: "script", text: "開いている" },
    "reference",
    "扉は開いた",
  );
  m.initial = [
    {
      id: fid("initial"),
      text: first.evidence,
      at: 0,
      providedAt: null,
      information: [first],
    },
  ];
  s.presentations = [
    presentation("echo", "扉は閉まったままだ", [
      { ...first, evidence: "扉は閉まったままだ" },
    ]),
    presentation("success", "扉は開いた", [changed]),
    {
      ...presentation("summary", "扉が開いたと振り返った", [
        { ...changed, evidence: "扉が開いたと振り返った" },
      ]),
      kind: "result",
    },
    presentation("empty", "本文の対応漏れ", []),
  ];
  const result = measure(m);
  expect(result.total.counts).toEqual({
    node: 0,
    edge: 0,
    aspect: 0,
    update: 1,
  });
  expect(result.total.coverage).toMatchObject({
    mapped: 4,
    adequacy: "unreviewed",
  });
  expect(
    result.diffs.flatMap((d) => d.elements.map((r) => r.category)),
  ).toEqual(["repeat", "update", "repeat"]);
  s.presentations[0]!.information = [info("invented", "架空の版")];
  expect(measure(m).total.value).toBeNull();
});

test("要約で提示自体を選んだ場合も保存済みの正本参照をそのまま再利用する", () => {
  const original = canonicalInformation(
    {
      id: fid("event"),
      kind: "event",
      text: "扉が開いた",
      period: { from: 1, until: 1 },
    },
    "generated",
    "扉が開いた",
  );
  const source = presentation("source", "扉が開いた", [original]);
  const row = {
    id: fid("scene"),
    actor_id: fid("actor"),
    state: "result",
    data: {
      recordingVersion: "inspection-record-v2",
      startedAt: 0,
      at: 1,
      presentations: [source],
      events: [],
      actions: [],
      informationBasis: { [original.id]: original },
      result: "扉が開いたことを振り返った",
      resultInformation: [{ id: source.id }],
    },
  } as unknown as SceneRow;
  recordPresentations(row);
  expect(row.data.presentations![1]!.information).toEqual([
    { ...original, evidence: row.data.result },
  ]);
});

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

test("窓前の提示で対応が不明なら既知集合が完全とは扱わない", () => {
  const m = inspectionFixture();
  m.prior[0]!.sceneId = fid("prior-scene");
  m.prior[0]!.information = null;
  const r = measure(m);
  expect(r.total.value).toBeNull();
  expect(r.status).toBe("partial");
  expect(r.priorMissingScenes).toContain(fid("prior-scene"));
});

test("初期提示を既知集合へ加え、未記録と旧指標を区別する", () => {
  const m = inspectionFixture();
  m.initial = [
    {
      id: fid("initial-known"),
      text: "橋板が腐っている",
      at: 0,
      providedAt: "2026-10-27T23:59:00.000Z",
      information: [info("refusal", "橋板が腐っている")],
    },
  ];
  expect(measure(m).total.value).toBe(6);
  expect(
    measure(m)
      .diffs.flatMap((d) => d.elements)
      .some((e) => e.id === fid("refusal") && e.category === "repeat"),
  ).toBe(true);
  m.initial = null;
  expect(measure(m)).toMatchObject({
    initialMissing: true,
    status: "partial",
    total: { value: null },
  });
  const legacy = { ...m };
  delete legacy.initial;
  const old = InspectionManifest.parse({
    ...legacy,
    recordVersion: "inspection-record-v1",
    selection: { ...m.selection, metricVersion: "presentation-v1" },
  });
  expect(old.initial).toBeUndefined();
  expect(measure(old)).toMatchObject({
    initialMissing: true,
    total: { value: 7 },
  });
});

test("引用候補は当該応答を必須とし、元のIDと原文へ復元する", () => {
  const m = inspectionFixture(),
    sources = [m.prior[0]!, m.scenes[0]!.presentations[0]!],
    item = inspectionItem("input", sources, [1]);
  const current = item.quotes.find((q) => q.presentationId === 1)!,
    previous = item.quotes.find((q) => q.presentationId === 0)!;
  const value = {
    units: [
      {
        text: "入力の復唱",
        category: "duplicate",
        importance: 0,
        evidence: {
          current: { quoteIndex: current.quoteIndex },
          context: [{ quoteIndex: previous.quoteIndex }],
        },
        explanation: "既知情報の再提示",
      },
    ],
    responsiveness: "responsive",
    principle: "consistent",
    principleEvidence: [
      { quoteIndex: current.quoteIndex, explanation: "当該応答を確認" },
    ],
    disagreements: [{ presentationId: 0, explanation: "比較元" }],
  };
  const { disagreements, ...part } = item.restore(item.schema.parse(value));
  expect(part.units[0]!.evidence).toEqual([
    { presentationId: sources[1]!.id, quote: current.text },
    { presentationId: sources[0]!.id, quote: previous.text },
  ]);
  expect(disagreements[0]!.presentationId).toBe(sources[0]!.id);
  const wrong = structuredClone(value);
  wrong.units[0]!.evidence.current.quoteIndex = previous.quoteIndex;
  expect(() => item.schema.parse(wrong)).toThrow();
});

test("引用候補は原文の短い範囲を保持し、引用文を生成しない", () => {
  const source = [
    { text: "村人が返事をした。落ち葉、小石がある！\n返事を待つ。" },
    { text: "……。" },
  ];
  const quotes = quoteSources(source);
  expect(quotes.map((q) => q.text)).toEqual([
    "村人が返事をした。",
    "落ち葉、",
    "小石がある！",
    "返事を待つ。",
    "……。",
  ]);
  expect(quotes.map((q) => q.quoteIndex)).toEqual([0, 1, 2, 3, 4]);
  for (const q of quotes)
    expect(source[q.presentationId]!.text).toContain(q.text);
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

test("生成用の対応情報は実際の提示本文と結び、旧形式の引用を上書きしない", () => {
  const reference = {
    kind: "node",
    id: fid("evidence"),
    aspect: "状態",
    state: "開いた",
    at: 0,
    version: null,
    origin: "reference",
  };
  expect(
    presentationEvidence({ text: "扉が開いた。", information: [reference] }),
  ).toMatchObject({ information: [{ evidence: "扉が開いた。" }] });
  expect(
    presentationEvidence({
      text: "扉が開いた。",
      information: [{ ...reference, evidence: "旧形式の引用" }],
    }),
  ).toMatchObject({ information: [{ evidence: "旧形式の引用" }] });
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

test("構造対応の欠測と本文・履歴の欠測を分けて意味評価する", () => {
  const m = inspectionFixture();
  const assessment = {
    inputs: m.scenes.flatMap((s) =>
      s.inputs.map((i) => ({
        inputId: i.id,
        units: [],
        responsiveness: "responsive",
        principle: "consistent",
        principleEvidence: [],
        missing: [] as string[],
      })),
    ),
    otherPresentations: m.scenes.flatMap((s) =>
      s.presentations
        .filter((p) => p.kind !== "response")
        .map((p) => ({ presentationId: p.id, units: [], missing: [] })),
    ),
    overall: {
      newInformation: 0,
      importance: null,
      responsiveness: "結果を確認",
      stagnation: "なし",
      principle: "consistent",
      explanation: "本文を評価",
      missing: [],
    },
    disagreements: [],
  };
  m.prior[0]!.information = null;
  m.scenes[0]!.presentations[0]!.information = null;
  expect(measure(m).total.value).toBeNull();
  expect(validateAssessment(assessment, m).overall.newInformation).toBe(0);
  m.priorMissingScenes = [fid("lost-history")];
  expect(validateAssessment(assessment, m).overall.newInformation).toBeNull();
  m.priorMissingScenes = [];
  m.requestedScenes = m.actualScenes + 1;
  expect(validateAssessment(assessment, m).overall.newInformation).toBeNull();
  m.requestedScenes = m.actualScenes;
  const absent = structuredClone(assessment);
  absent.inputs[0]!.missing.push("入力の応答本文が未保存");
  expect(validateAssessment(absent, m).overall.newInformation).toBeNull();
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
