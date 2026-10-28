import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  Operation,
  InspectionReadResult,
  InspectionMeasurement,
} from "@gestaloka/contracts";

export type InspectionClient = (
  command: z.input<typeof Operation>,
  requestId?: string,
) => Promise<Record<string, unknown>>;
export function inspectionClient(
  env: NodeJS.ProcessEnv = process.env,
  transport: typeof fetch = fetch,
): InspectionClient {
  const base = (env.GESTALOKA_API_URL ?? "http://127.0.0.1:3000").replace(
    /\/+$/,
    "",
  );
  if (!env.GESTALOKA_COOKIE && !env.GESTALOKA_MCP_TOKEN)
    throw new Error(
      "GESTALOKA_COOKIEまたはGESTALOKA_MCP_TOKENをローカルへ設定してください",
    );
  return async (command, requestId = randomUUID()) => {
    const parsed = Operation.parse(command),
      mcp = !!env.GESTALOKA_MCP_TOKEN;
    const { operation, ...args } = parsed;
    const response = await transport(
      `${base}${mcp ? "/mcp" : "/api/operations"}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Gestaloka-Request": "1",
          ...(mcp
            ? {
                Authorization: `Bearer ${env.GESTALOKA_MCP_TOKEN}`,
                "MCP-Protocol-Version": "2025-11-25",
                Accept: "application/json, text/event-stream",
              }
            : { Cookie: env.GESTALOKA_COOKIE! }),
        },
        body: JSON.stringify(
          mcp
            ? {
                jsonrpc: "2.0",
                id: requestId,
                method: "tools/call",
                params: {
                  name: operation.replaceAll(".", "_"),
                  arguments: { ...args, requestId },
                },
              }
            : { requestId, command: parsed },
        ),
        signal: AbortSignal.timeout(60000),
      },
    );
    if (!response.ok) throw new Error(`検品API: HTTP ${response.status}`);
    const data = mcp
      ? parseMcpMessage(await response.text())
      : await response.json();
    if (!mcp) return z.record(z.string(), z.unknown()).parse(data.result);
    if (data.error || data.result?.isError)
      throw new Error("検品MCP操作を取得できません");
    return z
      .record(z.string(), z.unknown())
      .parse(
        JSON.parse(
          data.result.content.find((c: { type: string }) => c.type === "text")
            .text,
        ),
      );
  };
}
export function parseMcpMessage(body: string) {
  const data = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  return JSON.parse(data.at(-1) ?? body);
}
export async function inspectionReport(
  client: InspectionClient,
  worldId: string,
  manifestId: string,
) {
  let after: number | undefined;
  let first: z.infer<typeof InspectionReadResult> | undefined;
  const items: z.infer<typeof InspectionReadResult>["items"] = [];
  do {
    const page = InspectionReadResult.parse(
      await client({
        operation: "inspection.read",
        worldId,
        manifestId,
        ...(after === undefined ? {} : { after }),
      }),
    );
    if (page.manifest.id !== manifestId || page.fetched.offset !== (after ?? 0))
      throw new Error("検品資料の対象または取得順序が一致しません");
    first ??= page;
    items.push(...page.items);
    if (page.next !== null && page.next <= (after ?? -1))
      throw new Error("検品資料の続きが進みません");
    after = page.next ?? undefined;
  } while (after !== undefined);
  if (
    items.length !== first!.fetched.total ||
    new Set(items.map((i) => i.id)).size !== items.length
  )
    throw new Error("検品資料が揃っていません");
  const measurement = InspectionMeasurement.parse({
    ...first!.measurement,
    scenes: items
      .filter((i) => i.section === "measure-scene")
      .map((i) => i.value),
    diffs: items
      .filter((i) => i.section === "measure-diff")
      .map((i) => i.value),
  });
  return {
    status: measurement.status,
    manifest: first!.manifest,
    measurement,
    items,
  };
}
export type InspectionReport = Awaited<ReturnType<typeof inspectionReport>>;
export function compareInspections(
  left: InspectionReport,
  right: InspectionReport,
  evaluations: { left: unknown; right: unknown } = { left: null, right: null },
) {
  if (
    left.measurement.metricVersion !== right.measurement.metricVersion ||
    JSON.stringify(left.measurement.weights) !==
      JSON.stringify(right.measurement.weights)
  )
    throw new Error("比較には同じ指標・重み設定が必要です");
  const conditions = (r: InspectionReport) => ({
    n: r.manifest.requestedScenes,
    actualScenes: r.manifest.actualScenes,
    inputCount: r.measurement.total.inputCount,
    scenes: r.manifest.sceneOrder.map((s) => s.id),
    models: [
      ...new Set(
        r.items
          .filter((i) => i.section === "call")
          .map((i) => {
            const c = i.value as {
              model: unknown;
              configurationVersion: unknown;
            };
            return JSON.stringify([c.model, c.configurationVersion]);
          }),
      ),
    ].sort(),
    evaluation: r === left ? evaluations.left : evaluations.right,
  });
  const a = conditions(left),
    b = conditions(right);
  return {
    left: left.manifest.id,
    right: right.manifest.id,
    conditions: { left: a, right: b },
    mismatches: Object.keys(a).filter(
      (k) =>
        JSON.stringify(a[k as keyof typeof a]) !==
        JSON.stringify(b[k as keyof typeof b]),
    ),
    valueDifference:
      left.measurement.total.value !== null &&
      right.measurement.total.value !== null
        ? right.measurement.total.value - left.measurement.total.value
        : null,
    observedDifference:
      right.measurement.total.observedValue -
      left.measurement.total.observedValue,
    interpretation:
      "異なる条件の差は優劣やモデル変更の因果効果を意味しない。評価条件は各報告の実行記録を参照。",
  };
}
export function readableInspection(
  report: InspectionReport,
  semantic?: unknown,
) {
  const m = report.measurement;
  const lines = [
    `# 物語検品 ${report.manifest.id}`,
    `状態: ${report.status === "complete" ? "完了" : "部分評価"}`,
    `指標: ${m.metricVersion} / 重み: ${m.weights.version}`,
    `シーン: 要求${m.requestedScenes} / 実${m.actualScenes} / 入力${m.total.inputCount}`,
    `初期提示: ${report.manifest.initialRecording === "recorded" ? "記録あり" : "欠測（旧指標の保存値には初期提示を含まない）"}`,
    `移動量: ${m.total.value ?? "欠測"}（確認済み部分 ${m.total.observedValue}）`,
    `対応記録あり: ${m.total.coverage.mapped}/${m.total.coverage.presentations}（対応の十分さは意味検品で確認）`,
    `最長の連続低移動入力: ${m.longestLowRun}`,
    `生成費用: ${m.total.calculatedNanoUsd === null ? "欠測" : Number(m.total.calculatedNanoUsd) / 1e9 + " USD"}`,
    `応答待ち: ${m.total.responseWaitMs ?? "欠測"} ms / モデルcall: ${m.total.modelCallMs ?? "欠測"} ms`,
    "",
    "| シーン・入力 | 状態 | ノード初提示 | エッジ初提示 | 別側面 | 更新 | 値 |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const s of m.scenes)
    for (const v of [s, ...s.inputs])
      lines.push(
        `| ${v.id} | ${v.state} | ${v.counts.node} | ${v.counts.edge} | ${v.counts.aspect} | ${v.counts.update} | ${v.value ?? "欠測"} |`,
      );
  lines.push("", "## 提示と根拠");
  for (const item of report.items.filter(
    (i) =>
      i.section === "presentation" ||
      i.section === "initial" ||
      i.section === "prior" ||
      i.section === "input",
  )) {
    const v = item.value as { text?: string };
    lines.push("", `### ${item.id}`, v.text ?? "");
  }
  lines.push(
    "",
    "## 低移動区間",
    ...m.lowRuns.map((r) => r.inputIds.join(" → ")),
    "",
    "## 限界",
    ...m.limitations,
  );
  if (semantic)
    lines.push(
      "",
      "## 意味評価と原則適合",
      "LLMによる推定。生成費用とは別に評価費用を記録。",
      "```json",
      JSON.stringify(semantic, null, 2),
      "```",
    );
  lines.push("", "全文・対応要素・内部根拠は同じJSON報告のitemsを参照。", "");
  return lines.join("\n");
}
