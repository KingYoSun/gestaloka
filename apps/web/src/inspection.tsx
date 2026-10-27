import { z } from "zod";
import { InspectionReadResult } from "@gestaloka/contracts";
import { Button } from "./components/ui/button.js";

type Values = Record<string, unknown>;
const number = (v: number | null) =>
  v === null
    ? "欠測"
    : v.toLocaleString(undefined, { maximumFractionDigits: 3 });
const Series = z.object({
  seriesId: z.string(),
  manifestIds: z.array(z.string()),
  windows: z.number(),
  measuredWindows: z.number(),
  missingWindows: z.number(),
  mean: z.number().nullable(),
  median: z.number().nullable(),
  p10: z.number().nullable(),
  distribution: z.array(z.number()),
  uniqueScenes: z.number(),
  uniqueInputs: z.number(),
  uniqueCalls: z.number(),
  calculatedNanoUsd: z.string().nullable(),
  longestLowRun: z.number(),
  metricVersion: z.string(),
  n: z.number(),
  weights: z.object({ version: z.string() }),
  semanticSeries: z.array(
    z.object({ manifestId: z.string(), evaluation: z.unknown() }),
  ),
});
const Point = z.object({
  id: z.string(),
  at: z.string(),
  selection: z.object({ worldId: z.string() }),
  measurement: z.object({
    total: z.object({
      value: z.number().nullable(),
      observedValue: z.number(),
      perUsd: z.number().nullable(),
      perWaitSecond: z.number().nullable(),
      coverage: z.object({ mapped: z.number(), presentations: z.number() }),
    }),
    metricVersion: z.string(),
    weights: z.object({ version: z.string() }),
    longestLowRun: z.number(),
  }),
  evaluations: z.array(
    z.object({ id: z.string(), status: z.string(), result: z.unknown() }),
  ),
});
const History = z.object({
  summary: z.array(Series),
  items: z.array(Point),
  batches: z.array(z.unknown()),
});

function Trend({ points }: { points: (number | null)[] }) {
  const maximum = Math.max(
    1,
    ...points.flatMap((v) => (v === null ? [] : [v])),
  );
  const segments: string[][] = [[]];
  points.forEach((v, i) => {
    if (v === null) segments.push([]);
    else
      segments
        .at(-1)!
        .push(
          `${10 + (i * 480) / Math.max(1, points.length - 1)},${110 - (v * 100) / maximum}`,
        );
  });
  return (
    <figure>
      <svg
        viewBox="0 0 500 130"
        role="img"
        aria-label="取得した窓の移動量の時系列。欠測で線を区切る。"
      >
        <line
          x1="10"
          y1="110"
          x2="490"
          y2="110"
          stroke="currentColor"
          opacity="0.3"
        />
        {segments
          .filter((s) => s.length)
          .map((s, i) => (
            <polyline
              key={i}
              points={s.join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          ))}
        {points.map((v, i) =>
          v === null ? null : (
            <circle
              key={i}
              cx={10 + (i * 480) / Math.max(1, points.length - 1)}
              cy={110 - (v * 100) / maximum}
              r="3"
              fill="currentColor"
            />
          ),
        )}
        <text x="10" y="128" fontSize="12">
          古い記録から新しい記録へ / 最大 {number(maximum)}
        </text>
      </svg>
      <figcaption>同じ条件の窓単位の時系列。欠測は線を区切ります。</figcaption>
    </figure>
  );
}

export function InspectionResults({
  value,
  onUse,
}: {
  value: Values;
  onUse?: ((v: Values) => void) | undefined;
}) {
  if (value.kind === "inspection-history") {
    const report = History.parse(value);
    return (
      <>
        <h2>物語移動量の推移と分布</h2>
        <p>
          分布は同条件のnシーン窓、総数と費用は窓に含まれる重複しない記録です。窓の開始前のシーンも含みます。欠測は0点へ置き換えません。
        </p>
        {report.summary.map((s) => (
          <article className="admin-record" key={s.seriesId}>
            <h3>
              {s.metricVersion} / {s.weights.version} / {s.n}シーン
            </h3>
            <Trend
              points={report.items
                .filter((p) => s.manifestIds.includes(p.id))
                .map((p) => p.measurement.total.value)}
            />
            <p>
              対象窓 {s.windows} / 計測可能 {s.measuredWindows} / 欠測{" "}
              {s.missingWindows}
            </p>
            <p>
              平均 {number(s.mean)} / 中央値 {number(s.median)} / 下位10%{" "}
              {number(s.p10)} / 最長低移動入力 {s.longestLowRun}
            </p>
            <p>
              重複しないシーン {s.uniqueScenes} / 入力 {s.uniqueInputs} / call{" "}
              {s.uniqueCalls} / 生成費用{" "}
              {s.calculatedNanoUsd === null
                ? "欠測"
                : number(Number(s.calculatedNanoUsd) / 1e9) + " USD"}
            </p>
            <details>
              <summary>窓単位の分布</summary>
              <p>
                {s.distribution.map(number).join(" / ") || "計測可能な値なし"}
              </p>
            </details>
          </article>
        ))}
        <div className="admin-table">
          <table>
            <caption>
              取得ページ内の時系列。指標・重みの異なる行は別系列です。
            </caption>
            <thead>
              <tr>
                <th>採取日時</th>
                <th>指標・重み</th>
                <th>移動量</th>
                <th>提示対応</th>
                <th>値/USD</th>
                <th>値/待ち秒</th>
                <th>根拠</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((p) => (
                <tr key={p.id}>
                  <td>{new Date(p.at).toLocaleString()}</td>
                  <td>
                    {p.measurement.metricVersion} /{" "}
                    {p.measurement.weights.version}
                  </td>
                  <td>
                    {number(p.measurement.total.value)}（確認分{" "}
                    {number(p.measurement.total.observedValue)}）
                  </td>
                  <td>
                    {p.measurement.total.coverage.mapped}/
                    {p.measurement.total.coverage.presentations}
                  </td>
                  <td>{number(p.measurement.total.perUsd)}</td>
                  <td>{number(p.measurement.total.perWaitSecond)}</td>
                  <td>
                    <Button
                      variant="outline"
                      onClick={() =>
                        onUse?.({
                          operation: "inspection.read",
                          worldId: p.selection.worldId,
                          manifestId: p.id,
                        })
                      }
                    >
                      提示と根拠
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h2>意味評価・原則適合</h2>
        <p>
          LLMの推定を別系列として表示します。モデル・ルーブリック・対象数・未評価数は実行記録を参照してください。
        </p>
        {report.items.flatMap((p) =>
          p.evaluations.map((e) => (
            <article key={e.id} className="admin-record">
              <p>
                実行 {e.id} / 状態 {e.status}
              </p>
              <Button
                variant="outline"
                onClick={() =>
                  onUse?.({
                    operation: "inspection.evaluation",
                    worldId: p.selection.worldId,
                    id: e.id,
                  })
                }
              >
                評価の根拠と費用
              </Button>
              <details>
                <summary>評価内容・モデル・ルーブリック</summary>
                <pre>{JSON.stringify(e.result, null, 2)}</pre>
              </details>
            </article>
          )),
        )}
        <details>
          <summary>対象の選定・評価済み数・未評価数・評価費用</summary>
          <pre>{JSON.stringify(report.batches, null, 2)}</pre>
        </details>
      </>
    );
  }
  const report = InspectionReadResult.parse(value),
    m = report.measurement;
  return (
    <>
      <h2>固定した検品資料</h2>
      <p>資料 {report.manifest.id}</p>
      <p>
        要求 {m.requestedScenes}シーン / 実 {m.actualScenes}シーン / 入力{" "}
        {m.total.inputCount}
      </p>
      <p>
        移動量 {number(m.total.value)} / 確認済み部分 {m.total.observedValue} /
        最長低移動入力 {m.longestLowRun}
      </p>
      <p>
        ノード初提示 {m.total.counts.node} / エッジ初提示 {m.total.counts.edge}{" "}
        / 別側面 {m.total.counts.aspect} / 更新 {m.total.counts.update}
      </p>
      <p>
        提示対応 {m.total.coverage.mapped}/{m.total.coverage.presentations} /
        資料取得 {report.fetched.offset + report.fetched.count}/
        {report.fetched.total}{" "}
        {report.next === null ? "（このページが末尾）" : "（続きあり）"}
      </p>
      <p>
        指標 {m.metricVersion} / 重み {m.weights.version}。{m.weights.rationale}
      </p>
      {report.items.map((item) => (
        <article key={item.id} className="admin-record" id={item.id}>
          <h3>
            {item.section === "administrator"
              ? "管理者向けの検品根拠"
              : item.section === "prior"
                ? "窓より前の提示"
                : item.section === "input"
                  ? "プレイヤー入力"
                  : item.section === "presentation"
                    ? "本人への提示"
                    : item.section === "measure-scene"
                      ? "シーンと入力の計測"
                      : "対応・生成の記録"}
          </h3>
          <p className="record-meta">
            {item.id} {item.inputId ? ` / 入力 ${item.inputId}` : ""}
          </p>
          {item.value &&
          typeof item.value === "object" &&
          "text" in item.value &&
          typeof item.value.text === "string" ? (
            <p>{item.value.text}</p>
          ) : null}
          <details>
            <summary>本文・対応要素・版・状態を確認</summary>
            <pre>{JSON.stringify(item.value, null, 2)}</pre>
          </details>
        </article>
      ))}
    </>
  );
}
