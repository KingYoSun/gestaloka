import { useId } from "react";
import { z } from "zod";
import { Operation } from "@gestaloka/contracts";
import { Input } from "./components/ui/input.js";
import { Textarea } from "./components/ui/textarea.js";
import { Label } from "./components/ui/label.js";

export type Values = Record<string, unknown>;
export const object = (v: unknown): Values =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Values) : {};
export const labels: Record<string, string> = {
  selection: "対象の選択",
  actorId: "操作対象ID",
  endSceneId: "終端シーンID",
  n: "窓のシーン数",
  manifestId: "資料ID",
  metricVersion: "指標版",
  weightVersion: "重み版",
  configurationVersion: "モデル設定版",
  lowThreshold: "低移動量の閾値",
  weights: "固定重み",
  values: "区分ごとの重み",
  rationale: "重みの根拠・限界",
  node: "ノード初提示",
  edge: "エッジ初提示",
  aspect: "別側面",
  update: "更新提示",
  evaluation: "意味評価",
  target: "評価担当の設定",
  intervalMinutes: "意味評価の間隔（分）",
  periodHours: "対象期間（時間）",
  sampleCount: "意味評価の対象窓数",
  configuration: "設定内容",
  default: "観測・意図・シーンの担当",
  resolution: "生成・結果提案・確定の担当",
  provider: "APIサービス",
  model: "モデルID",
  baseUrl: "API接続先",
  harnessBaseUrl: "dsh接続先",
  api: "API形式",
  effort: "通常の推論量",
  initialEffort: "初期生成の推論量",
  contextTokens: "コンテキストのトークン数",
  maxOutputTokens: "最大出力トークン数",
  inputUsdPerMillion: "通常入力単価（USD / 100万トークン）",
  cachedInputUsdPerMillion: "キャッシュ読取単価（USD / 100万トークン）",
  cacheWrite5mUsdPerMillion: "5分キャッシュ作成単価（USD / 100万トークン）",
  cacheWrite1hUsdPerMillion: "1時間キャッシュ作成単価（USD / 100万トークン）",
  outputUsdPerMillion: "出力単価（USD / 100万トークン）",
  pricingDate: "単価の基準日",
  judgment: "提案と確定の呼び出し方式",
  reason: "操作の理由",
  expectedVersion: "変更前の設定版",
  version: "設定版",
  id: "ID",
  userId: "ユーザーID",
  role: "役割",
  banned: "利用停止（BAN）",
  enabled: "有効にする",
  expiresAt: "有効期限",
  maxUses: "利用可能回数",
  inviteId: "招待ID",
  token: "招待トークン",
  uses: "利用回数",
  revoked: "失効済み",
  value: "新しいAPIキー",
  worldId: "世界ID",
  budgetUsd: "世界の予算上限（USD）",
  limitUsd: "予算上限（USD）",
  upperCostUsd: "計算済み額と未確定予約額の合計（USD）",
  calls: "call回数",
  name: "名称",
  limits: "共有枠（未指定なら追加制御なし）",
  concurrency: "並行処理数",
  requestsPerMinute: "毎分の要求数",
  tokensPerMinute: "毎分のトークン数",
  paused: "メンテナンス・運用停止",
  sampleIntervalSeconds: "監視の取得間隔（秒）",
  retentionDays: "保持期間（日）",
  thresholds: "通知の閾値（指定した項目のみ判定）",
  errorPercent: "エラー率（%）",
  latencyMs: "応答時間（ミリ秒）",
  queueAgeSeconds: "キュー待機時間（秒）",
  postgresBytes: "PostgreSQL使用量（byte）",
  postgresConnectionPercent: "PostgreSQL接続使用率（%）",
  postgresUnavailable: "PostgreSQL接続失敗",
  graphUnavailable: "グラフDB接続失敗",
  calculatedUsd: "計算済み額（USD）",
  unsettledUsd: "未確定予約額（USD）",
  url: "通知先Webhook（未指定なら無効）",
  webhookConfigured: "通知先の設定済み状態",
  webhookVersion: "通知先の設定版",
  kind: "種類",
  query: "取得条件",
  from: "開始",
  to: "終了",
  interval: "集計間隔",
  view: "表示内容",
  task: "処理担当",
  responseId: "応答ID",
  operationId: "世界操作ID",
  callId: "API呼び出しID",
  before: "前ページのカーソル",
  after: "次ページのカーソル",
  state: "状態",
  outcome: "受付結果",
  code: "保留・拒否の理由コード",
  resource: "MCP接続先",
  error: "エラー",
  errorCode: "エラーコード",
  requestId: "要求ID",
  commitId: "確定ID",
  createdAt: "作成日時",
  updatedAt: "更新日時",
  updatedBy: "更新者",
  createdBy: "作成者",
  startedAt: "開始日時",
  finishedAt: "終了日時",
  usedAt: "使用日時",
  repository: "バックアップ先（s3:https://…）",
  accessKey: "S3アクセスキー",
  secretKey: "S3秘密キー",
  password: "暗号化パスワード（16文字以上）",
  region: "S3リージョン",
  intervalHours: "取得間隔（時間）",
  snapshot: "復元するスナップショットID",
  clientId: "MCPクライアントID",
  grantId: "認可ID",
  redirectUris: "Callback URL（1行に1件）",
  scopes: "許可する操作",
  worldIds: "対象世界ID（未指定なら全世界・1行に1件）",
  at: "世界内時点（ミリ秒）",
  through: "履歴の終了時点",
  relation: "関係の種類",
  direction: "関係の方向",
  dependencies: "依存した版",
  changes: "世界への差分",
  prompt: "世界の初期設定",
  command: "進行操作",
  durationMs: "進める期間（ミリ秒）",
  title: "名称",
  description: "説明",
  published: "登録済み全員へ公開",
  accepting: "新規参加を受付",
  settings: "生成用の設定本文",
  presetId: "プレイヤー設定ID",
  calculatedNanoUsd: "計算済み額",
  reservedNanoUsd: "送信済み・未確定予約額",
  unknownNanoUsd: "使用量不明分の予約額",
  reservationNanoUsd: "予約額",
  elapsedMs: "所要時間（ミリ秒）",
  usage: "トークン使用量",
  ratesNanoUsdPerToken: "保存済みの算定単価",
  credentials: "APIキーの設定情報",
};
export const label = (key: string) => labels[key] ?? key;
export const secretField = (name: string) =>
  ["value", "accessKey", "secretKey", "password", "url"].includes(name);
export type Shape = {
  type?: string;
  const?: unknown;
  enum?: string[];
  default?: unknown;
  format?: string;
  properties?: Record<string, Shape>;
  propertyNames?: { enum?: string[] };
  additionalProperties?: Shape | boolean;
  required?: string[];
  items?: Shape;
  anyOf?: Shape[];
  oneOf?: Shape[];
  minLength?: number;
  minimum?: number;
};
export const formShape = (schema: z.ZodType) => z.toJSONSchema(schema) as Shape;
const branches = (s: Shape) => s.anyOf ?? s.oneOf;
export function initial(s: Shape): unknown {
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  const options = branches(s);
  if (options)
    return options.some((v) => v.type === "null") ? null : initial(options[0]!);
  if (s.enum) return s.enum[0];
  if (s.type === "object")
    return Object.fromEntries(
      Object.entries(s.properties ?? {})
        .filter(([k]) => s.required?.includes(k))
        .map(([k, v]) => [k, initial(v)]),
    );
  if (s.type === "array") return [];
  if (s.type === "boolean") return false;
  if (s.type === "number" || s.type === "integer") return s.minimum ?? 1;
  if (s.format === "date-time") return new Date().toISOString();
  if (s.format === "date") return new Date().toISOString().slice(0, 10);
  return "";
}
const localTime = (v: unknown) => {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime())
    ? ""
    : new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 19);
};
export function Fields({
  shape,
  value,
  onChange,
  name = "",
  required = true,
}: {
  shape: Shape;
  value: unknown;
  onChange: (v: unknown) => void;
  name?: string;
  required?: boolean;
}) {
  const id = useId(),
    options = branches(shape),
    nullable = options?.find((v) => v.type === "null");
  if (!required || nullable) {
    const active = required
      ? value !== undefined && value !== null
      : value !== undefined;
    const child =
      required && nullable ? options!.find((v) => v.type !== "null")! : shape;
    return (
      <div className="admin-field">
        <Label>
          <input
            type="checkbox"
            checked={active}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? initial(child)
                  : required && nullable
                    ? null
                    : undefined,
              )
            }
          />{" "}
          {label(name)}
          {required ? "に値を設定" : "を指定"}
        </Label>
        {active && (
          <Fields shape={child} value={value} onChange={onChange} name={name} />
        )}
      </div>
    );
  }
  if (options) {
    const selected = options.findIndex((s) =>
      Object.entries(s.properties ?? {}).some(
        ([k, v]) => v.const !== undefined && object(value)[k] === v.const,
      ),
    );
    const index = Math.max(0, selected);
    return (
      <fieldset className="admin-field">
        <legend>{label(name)}</legend>
        <Label htmlFor={id}>取得・操作の種類</Label>
        <select
          id={id}
          value={index}
          onChange={(e) => onChange(initial(options[Number(e.target.value)]!))}
        >
          {options.map((s, i) => (
            <option key={i} value={i}>
              {String(
                Object.values(s.properties ?? {}).find(
                  (v) => v.const !== undefined,
                )?.const ?? i,
              )}
            </option>
          ))}
        </select>
        <Fields
          shape={options[index]!}
          value={value}
          onChange={onChange}
          name={name}
        />
      </fieldset>
    );
  }
  if (shape.type === "object") {
    const properties =
      shape.properties ??
      Object.fromEntries(
        (shape.propertyNames?.enum ?? []).map((k) => [
          k,
          typeof shape.additionalProperties === "object"
            ? shape.additionalProperties
            : {},
        ]),
      );
    const body = Object.entries(properties)
      .filter(([k, v]) => k !== "operation" && v.const === undefined)
      .map(([k, s]) => (
        <Fields
          key={k}
          name={k}
          shape={s}
          required={shape.required?.includes(k) ?? false}
          value={object(value)[k]}
          onChange={(v) => {
            const next = { ...object(value), [k]: v };
            if (v === undefined) delete next[k];
            onChange(next);
          }}
        />
      ));
    return name ? (
      <fieldset className="admin-field">
        <legend>{label(name)}</legend>
        {body}
      </fieldset>
    ) : (
      <>{body}</>
    );
  }
  if (shape.const !== undefined) return null;
  if (shape.type === "array") {
    const values = Array.isArray(value) ? value.map(String) : [];
    return (
      <div className="admin-field">
        <Label htmlFor={id}>{label(name)}</Label>
        {name === "scopes" ? (
          <div id={id} className="scope-list">
            {Operation.options
              .map((s) => s.shape.operation.value)
              .map((scope) => (
                <Label key={scope}>
                  <input
                    type="checkbox"
                    checked={values.includes(scope)}
                    onChange={(e) =>
                      onChange(
                        e.target.checked
                          ? [...values, scope]
                          : values.filter((v) => v !== scope),
                      )
                    }
                  />{" "}
                  {scope}
                </Label>
              ))}
          </div>
        ) : (
          <Textarea
            id={id}
            value={values.join("\n")}
            onChange={(e) =>
              onChange(
                e.target.value
                  .split("\n")
                  .map((v) => v.trim())
                  .filter(Boolean),
              )
            }
          />
        )}
      </div>
    );
  }
  if (shape.type === "boolean")
    return (
      <Label className="admin-field">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />{" "}
        {label(name)}
      </Label>
    );
  const type = secretField(name)
    ? "password"
    : shape.type === "number" || shape.type === "integer"
      ? "number"
      : shape.format === "date-time"
        ? "datetime-local"
        : shape.format === "date"
          ? "date"
          : "text";
  return (
    <div className="admin-field">
      <Label htmlFor={id}>{label(name)}</Label>
      {shape.enum ? (
        <select
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          {shape.enum.map((v) => (
            <option key={v} value={v}>
              {v === "admin" ? "管理者" : v === "user" ? "一般ユーザー" : v}
            </option>
          ))}
        </select>
      ) : ["reason", "prompt", "description", "settings"].includes(name) ? (
        <Textarea
          id={id}
          value={String(value ?? "")}
          required
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          id={id}
          type={type}
          autoComplete={type === "password" ? "new-password" : "off"}
          value={
            type === "datetime-local" ? localTime(value) : String(value ?? "")
          }
          step={type === "number" ? "any" : undefined}
          required
          onChange={(e) =>
            onChange(
              type === "number"
                ? e.target.value === ""
                  ? ""
                  : Number(e.target.value)
                : type === "datetime-local" && e.target.value
                  ? new Date(e.target.value).toISOString()
                  : e.target.value,
            )
          }
        />
      )}
    </div>
  );
}
