import type {
  InspectionManifest,
  Information,
  Presentation,
} from "@gestaloka/contracts";

export const unitWeights = {
  version: "unit-v1",
  values: { node: 1, edge: 1, aspect: 1, update: 1 },
  rationale: "全区分1の未校正の基準値。満足度や意味的重要度を表さない。",
};
export function measure(manifest: InspectionManifest) {
  const canonicalRequired =
    manifest.selection.metricVersion === "presentation-v3";
  const missing = (p: { information: Information[] | null }) =>
    p.information === null ||
    (canonicalRequired && p.information.some((r) => !r.canonical));
  const initialMissing =
    manifest.initial == null || manifest.initial.some(missing);
  const initialRequired =
    manifest.selection.metricVersion !== "presentation-v1";
  const priorMissingScenes = [
    ...new Set([
      ...manifest.priorMissingScenes,
      ...manifest.prior.filter(missing).map((p) => p.sceneId),
    ]),
  ];
  const elements = new Set<string>(),
    aspects = new Set<string>(),
    states = new Set<string>();
  const classify = (r: Information) => {
    const element = JSON.stringify([r.kind, r.id]),
      aspect = JSON.stringify([element, r.aspect]);
    const state = JSON.stringify([aspect, r.state, r.version, r.at]);
    if (states.has(state)) return "repeat" as const;
    const category: "node" | "edge" | "aspect" | "update" = !elements.has(
      element,
    )
      ? r.kind
      : !aspects.has(aspect)
        ? "aspect"
        : "update";
    elements.add(element);
    aspects.add(aspect);
    states.add(state);
    return category;
  };
  for (const p of manifest.prior)
    for (const r of p.information ?? [])
      if (!canonicalRequired || r.canonical) classify(r);
  if (initialRequired)
    for (const p of manifest.initial ?? [])
      for (const r of p.information ?? [])
        if (!canonicalRequired || r.canonical) classify(r);
  const diffs = manifest.scenes.flatMap((s) =>
    s.presentations.map((p) => ({
      presentationId: p.id,
      sceneId: s.id,
      inputId: p.inputId,
      kind: p.kind,
      missing: missing(p),
      elements: (p.information ?? [])
        .filter((r) => !canonicalRequired || r.canonical)
        .map((r) => ({
          ...r,
          category: classify(r),
        })),
    })),
  );
  const summarize = (presentations: Presentation[]) => {
    const selected = new Set(presentations.map((p) => p.id));
    const parts = diffs.filter((d) => selected.has(d.presentationId));
    const counts = { node: 0, edge: 0, aspect: 0, update: 0 },
      origins = { reference: 0, generated: 0 };
    for (const d of parts)
      for (const r of d.elements)
        if (r.category !== "repeat") {
          counts[r.category]++;
          origins[r.origin]++;
        }
    const observedValue = Object.entries(counts).reduce(
      (sum, [k, c]) =>
        sum + c * manifest.selection.weights.values[k as keyof typeof counts],
      0,
    );
    const known = parts.filter((d) => !d.missing).length;
    return {
      counts,
      origins,
      observedValue,
      value:
        !(initialRequired && initialMissing) &&
        !priorMissingScenes.length &&
        known === parts.length
          ? observedValue
          : null,
      coverage: {
        presentations: parts.length,
        mapped: known,
        ratio: parts.length ? known / parts.length : null,
        ...(canonicalRequired ? { adequacy: "unreviewed" as const } : {}),
      },
      missing: parts.filter((d) => d.missing).map((d) => d.presentationId),
    };
  };
  const scenes = manifest.scenes.map((s) => {
    const inputs = s.inputs.map((a) => {
      const presentations = s.presentations.filter(
        (p) => p.inputId === a.id && p.kind === "response",
      );
      const result = summarize(presentations);
      const waitMs =
        a.submittedAt && a.completedAt
          ? Date.parse(a.completedAt) - Date.parse(a.submittedAt)
          : null;
      const calls = s.calls.filter((c) => c.responseId === a.id);
      return {
        id: a.id,
        state: a.state,
        ...result,
        value:
          s.recording === "legacy" ||
          (!presentations.length && a.state === "running")
            ? null
            : result.value,
        ...resources(
          calls,
          result.observedValue,
          waitMs,
          s.recording !== "legacy",
        ),
      };
    });
    const result = summarize(s.presentations);
    return {
      id: s.id,
      state: s.state,
      revision: s.revision,
      ...result,
      value: s.recording === "legacy" ? null : result.value,
      inputs,
      kinds: Object.fromEntries(
        (["synopsis", "response", "result"] as const).map((k) => [
          k,
          summarize(s.presentations.filter((p) => p.kind === k)),
        ]),
      ),
      ...resources(
        s.calls,
        result.observedValue,
        inputs.length && inputs.every((a) => a.responseWaitMs !== null)
          ? inputs.reduce((sum, a) => sum + a.responseWaitMs!, 0)
          : null,
        s.recording !== "legacy",
      ),
    };
  });
  const allInputs = scenes.flatMap((s) => s.inputs),
    lowRuns: { inputIds: string[]; length: number }[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) lowRuns.push({ inputIds: run, length: run.length });
    run = [];
  };
  for (const a of allInputs)
    if (a.value !== null && a.value <= manifest.selection.lowThreshold)
      run.push(a.id);
    else flush();
  flush();
  const total = summarize(manifest.scenes.flatMap((s) => s.presentations));
  const missingScenes = manifest.scenes
    .filter((s) => s.recording === "legacy")
    .map((s) => s.id);
  const known =
    scenes.every((s) => s.value !== null) &&
    !priorMissingScenes.length &&
    !(initialRequired && initialMissing);
  const waits = allInputs.map((a) => a.responseWaitMs),
    waitMs =
      waits.length && waits.every((v) => v !== null)
        ? waits.reduce<number>((a, b) => a + b!, 0)
        : null;
  return {
    manifestId: manifest.id,
    metricVersion: manifest.selection.metricVersion,
    weights: manifest.selection.weights,
    requestedScenes: manifest.requestedScenes,
    actualScenes: manifest.actualScenes,
    initialMissing,
    status:
      manifest.actualScenes < manifest.requestedScenes ||
      missingScenes.length ||
      total.missing.length ||
      (initialRequired && initialMissing) ||
      priorMissingScenes.length
        ? "partial"
        : "complete",
    total: {
      ...total,
      value: known ? total.value : null,
      inputCount: allInputs.length,
      perInput:
        known &&
        total.value !== null &&
        allInputs.length &&
        allInputs.every((a) => a.value !== null)
          ? scenes.reduce(
              (sum, s) =>
                sum + s.inputs.reduce((v, a) => v + (a.value ?? 0), 0),
              0,
            ) / allInputs.length
          : null,
      ...resources(
        manifest.scenes.flatMap((s) => s.calls),
        total.observedValue,
        waitMs,
        !missingScenes.length,
      ),
    },
    missingScenes,
    priorMissingScenes,
    scenes,
    diffs,
    lowRuns,
    longestLowRun: Math.max(0, ...lowRuns.map((r) => r.length)),
    limitations: [
      ...(initialMissing
        ? [
            "初期提示が未記録。旧指標presentation-v1の保存値は初期提示を比較元に含まない。",
          ]
        : []),
      "対応記録の有無と対応の十分さは別。構造対応と本文の意味的一致はLLM検品の対象。別IDの同義情報は決定論では除外しない。",
      "提供はサーバー出力としての提供可能時点。閲読・理解やネットワーク待ちを推定しない。",
      "費用は既存台帳の計算額。準備・反映費用を入力へ按分しない。",
    ],
  };
}

function resources(
  calls: InspectionManifest["scenes"][number]["calls"],
  value: number,
  waitMs: number | null,
  costsRecorded = true,
) {
  const complete =
    costsRecorded && calls.length > 0 && calls.every((c) => c.nanoUsd !== null);
  const nano = complete
    ? calls.reduce((sum, c) => sum + BigInt(c.nanoUsd!), 0n).toString()
    : null;
  const modelMs =
    calls.length && calls.every((c) => c.elapsedMs !== null)
      ? calls.reduce((sum, c) => sum + c.elapsedMs!, 0)
      : null;
  return {
    calls: calls.length,
    calculatedNanoUsd: nano,
    knownNanoUsd: calls
      .reduce((sum, c) => sum + BigInt(c.nanoUsd ?? "0"), 0n)
      .toString(),
    costMissing: !complete,
    modelCallMs: modelMs,
    responseWaitMs: waitMs,
    perUsd:
      nano !== null && BigInt(nano) > 0n ? value / (Number(nano) / 1e9) : null,
    perWaitSecond:
      waitMs !== null && waitMs > 0 ? value / (waitMs / 1000) : null,
  };
}
export type Measurement = ReturnType<typeof measure>;
