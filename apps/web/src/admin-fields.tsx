import { useId, useState } from "react";
import { z } from "zod";
import {
  defaultDice,
  Operation,
  type NonCombatAreas,
} from "@gestaloka/contracts";
import { Input } from "./components/ui/input.js";
import { Textarea } from "./components/ui/textarea.js";
import { Label } from "./components/ui/label.js";

export type Values = Record<string, unknown>;
export const object = (v: unknown): Values =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Values) : {};
export const labels: Record<string, string> = {
  selection: "対象の選択",
  actorId: "操作対象ID",
  actorIds: "宛先の人物ID（省くと全員）",
  authorId: "原案者の人物ID",
  template: "設計図テンプレート",
  installation: "製作した物を保管先として設置",
  relocatable: "管理者による移設を許可",
  pickup: "無償受領の対象（public は現地の全員、addressed は指定した本人）",
  templateId: "テンプレートID",
  instructions: "プレイヤー向けの使い方",
  testerIds: "試遊者の人物ID",
  materials: "建築に使う消費材と道具",
  mode: "完成後の効果",
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
  api: "API形式",
  effort: "通常の推論量",
  initialEffort: "初期生成の推論量",
  contextTokens: "コンテキストのトークン数",
  maxOutputTokens: "最大出力トークン数",
  inputUsdPerMillion: "通常入力単価（USD / 100万トークン）",
  cachedInputUsdPerMillion: "キャッシュ読取単価（USD / 100万トークン）",
  cacheWrite5mUsdPerMillion: "5分キャッシュ作成単価（USD / 100万トークン）",
  cacheWrite1hUsdPerMillion: "1時間キャッシュ作成単価（USD / 100万トークン）",
  cacheWrite30mUsdPerMillion:
    "OpenAI・30分キャッシュ作成単価（USD / 100万トークン）",
  cacheWrite12hUsdPerMillion:
    "OpenAI・12時間キャッシュ作成単価（USD / 100万トークン）",
  cacheStorageUsdPerMillionTokenHour:
    "Gemini・キャッシュ保管単価（USD / 100万トークン・時間）",
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
  controller: "操作担当（bot / server。nullは解除）",
  turnCalls: "1ターンの通常APIコール枠",
  receiptTimeoutSeconds: "受領判断の無応答期限（秒）",
  dailyLimit: "報告・感想の1日あたりの上限（件）",
  turnsPerReport: "報告1件に必要な通常手番数",
  maxCharacters: "報告・感想1件の文字数上限",
  promotionId: "NPC昇格申請ID",
  condition: "自動昇格の条件（空欄で手動のみ）",
  criteria: "新規作成の目標値の基準（空欄で既定、省略で現状維持）",
  dice: "判定に使うダイス",
  sides: "ダイス1個の面数",
  count: "個数",
  exploreCriteria: "探索の判定基準と拒否条件（空欄で既定、省略で現状維持）",
  defaultExploreCriteria: "探索の既定基準",
  skillCriteria:
    "技能の習得・発展・統合の判定基準と拒否条件（空欄で既定、省略で現状維持）",
  defaultSkillCriteria: "技能の習得・発展・統合の既定基準",
  fumbleCriteria: "ファンブルの基準（空欄で既定、省略で現状維持）",
  shown: "基準の文をプレイヤーへ表示",
  approve: "昇格を承認する（オフは却下）",
  sourceRequestId: "インスタントNPCが出現した発言の要求ID",
  npcIndex: "インスタントNPCの番号（0から）",
  sourceText: "出現時の発言",
  npcId: "昇格したNPCのID",
  decidedBy: "判断した管理者",
  name: "名称",
  limits: "共有枠（未指定なら追加制御なし）",
  concurrency: "並行処理数",
  requestsPerMinute: "毎分の要求数",
  tokensPerMinute: "毎分のトークン数",
  paused: "メンテナンス・運用停止",
  worldEditsUntil: "運用停止中に管理修正を許可する期限",
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
  advertisedReadScopes: "Web版ChatGPTに通知する読み取り権限",
  worldIds: "対象世界ID（未指定なら全世界・1行に1件）",
  at: "世界内時点（ミリ秒）",
  through: "履歴の終了時点",
  relation: "関係の種類",
  direction: "関係の方向",
  dependencies: "依存した版",
  changes: "世界への差分",
  prompt: "世界の初期設定",
  playerSettings: "参加者の基本設定（参加する一人ひとりに適用）",
  command: "進行操作",
  durationMs: "進める期間（ミリ秒）",
  title: "名称",
  description: "説明",
  published: "登録済み全員へ公開",
  accepting: "新規参加を受付",
  playerList: "出会えるフレンドと居場所の一覧を提供",
  instantNpcMultiplier: "出現個体の同席上限（発生数の倍率）",
  deathJudgment: "人物を死亡判定の対象にする",
  respawnEnabled: "死亡した人物をリスポーンさせる",
  respawnDisabled: "リスポーンなし",
  deathCriteria: "人物の死亡を判定する条件",
  deathPlaceId: "リスポーン先の場所ID",
  nonCombatAreas: "非戦闘地域",
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
export function NonCombatAreasField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: NonCombatAreas;
  onChange: (areas: NonCombatAreas) => void;
}) {
  const [draft, setDraft] = useState<string>();
  return (
    <>
      <Label htmlFor={id}>{label("nonCombatAreas")}</Label>
      <Textarea
        id={id}
        aria-describedby={`${id}-help`}
        value={
          draft ??
          value
            .map(({ rootId, memberPlaceIds }) =>
              [rootId, ...memberPlaceIds].join(" "),
            )
            .join("\n")
        }
        onBlur={() => setDraft(undefined)}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          onChange(
            text
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => {
                const [rootId, ...memberPlaceIds] = line.split(/\s+/);
                return { rootId: rootId!, memberPlaceIds };
              }),
          );
        }}
      />
      <p id={`${id}-help`} className="muted">
        1行に範囲のIDを一つ書きます。古い地理記録で範囲とのつながりが未登録の場所は、同じ行に空白区切りでIDを加えます。
      </p>
    </>
  );
}
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
                  ? name === "dice"
                    ? defaultDice
                    : initial(child)
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
    const backupDestination = options.some(
      (option) => option.properties?.repository?.const === "local",
    );
    const selected = options.findIndex((s) =>
      Object.entries(s.properties ?? {}).some(
        ([k, v]) => v.const !== undefined && object(value)[k] === v.const,
      ),
    );
    const index = Math.max(0, selected);
    return (
      <fieldset className="admin-field">
        <legend>{label(name)}</legend>
        <Label htmlFor={id}>
          {backupDestination ? "バックアップの保存先" : "取得・操作の種類"}
        </Label>
        <select
          id={id}
          value={index}
          onChange={(e) => onChange(initial(options[Number(e.target.value)]!))}
        >
          {options.map((s, i) => (
            <option key={i} value={i}>
              {backupDestination
                ? s.properties?.repository?.const === "local"
                  ? "配備先ホスト内"
                  : "S3"
                : String(
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
  if (name === "nonCombatAreas")
    return (
      <div className="admin-field">
        <NonCombatAreasField
          id={id}
          value={(value ?? []) as NonCombatAreas}
          onChange={onChange}
        />
      </div>
    );
  if (shape.type === "array") {
    const values = Array.isArray(value) ? value.map(String) : [];
    const scopes =
      name === "scopes"
        ? Operation.options.map((s) => s.shape.operation.value)
        : name === "advertisedReadScopes"
          ? (shape.items?.enum ?? [])
          : undefined;
    if (scopes)
      return (
        <fieldset className="admin-field">
          <legend>{label(name)}</legend>
          {name === "advertisedReadScopes" && (
            <p className="muted">
              「許可する操作」で選んだ読み取り権限から指定できます。保存後にWeb版ChatGPTでツールを更新し、再接続してください。
            </p>
          )}
          {scopes.length > 0 && (
            <div className="scope-list">
              {scopes.map((scope) => (
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
          )}
        </fieldset>
      );
    return (
      <div className="admin-field">
        <Label htmlFor={id}>{label(name)}</Label>
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
      ) : [
          "reason",
          "prompt",
          "criteria",
          "skillCriteria",
          "exploreCriteria",
          "fumbleCriteria",
          "playerSettings",
          "description",
          "settings",
        ].includes(name) ? (
        <Textarea
          id={id}
          value={String(value ?? "")}
          required={
            ![
              "criteria",
              "skillCriteria",
              "exploreCriteria",
              "fumbleCriteria",
            ].includes(name)
          }
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
