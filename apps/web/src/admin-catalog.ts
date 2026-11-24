import { Operation, isReadOnlyOperation } from "@gestaloka/contracts";
import type { z } from "zod";
export type Command = z.infer<typeof Operation>;
export type Name = Command["operation"];
export const operations = {
  inspection: [
    "物語の検品",
    {
      "inspection.history": "成績の推移・分布",
      "inspection.select": "検品対象のシーンを固定",
      "inspection.read": "提示文と根拠を読む",
      "inspection.evaluate": "保存資料を意味評価",
      "inspection.evaluation": "意味評価の実行結果",
      "inspection.settings": "定期検品の設定",
      "inspection.configure": "定期検品を設定",
    },
  ],
  worlds: [
    "世界・参加設定",
    {
      "worlds.list": "世界一覧",
      "worlds.read": "世界の状態",
      "worlds.records": "構築の記録",
      "worlds.create": "世界を生成",
      "worlds.command": "世界構築を進行・完了",
      "worlds.configure": "公開・参加受付",
      "worlds.disableActorRespawn": "人物のリスポーンを無効にする",
      "presets.list": "プレイヤー設定一覧",
      "presets.put": "プレイヤー設定を保存",
      "worldBudgets.read": "世界の予算を確認",
      "worldBudgets.put": "世界の予算を変更",
      "worlds.graph": "グラフと履歴を読む",
      "worlds.edit": "世界を直接編集",
      "blueprints.create": "設計図テンプレートの下書きを作る",
      "blueprints.publish": "試遊済みの設計図テンプレートを公開",
      "npcs.read": "ユニークNPCの操作担当",
      "npcs.put": "ユニークNPCの操作担当を指定",
      "npcs.promotions": "インスタントNPCの昇格申請",
      "promotionPolicy.read": "世界のNPC自動昇格条件",
      "promotionPolicy.put": "世界のNPC自動昇格条件を設定",
      "creationPolicy.read": "世界の新規作成のダイス基準",
      "creationPolicy.put": "世界の新規作成のダイス基準を設定",
      "npcs.decidePromotion": "NPCの昇格を承認・却下",
    },
  ],
  users: [
    "ユーザー・管理者",
    {
      "users.list": "ユーザー一覧",
      "users.role": "管理者任命・降格",
      "users.ban": "BAN・解除",
    },
  ],
  reports: [
    "報告・感想",
    {
      "reports.list": "プレイヤーからの報告・感想",
      "activity.read": "通常手番で活動したアカウントと生成GMの利用",
      "notices.send": "プレイヤーへお知らせを送る",
      "reportPolicy.read": "報告・感想の送信枠",
      "reportPolicy.put": "報告・感想の上限を変更",
    },
  ],
  stories: [
    "STORIES",
    {
      "stories.list": "作品一覧",
      "stories.read": "作品の目次・本文",
      "stories.stats": "世界別の投稿状況（公開中の作品・各話）",
    },
  ],
  invites: [
    "招待",
    {
      "settings.read": "招待制の状態",
      "settings.invites": "招待制を切り替え",
      "invites.list": "招待一覧",
      "invites.create": "招待トークンを発行",
      "invites.uses": "招待の利用記録",
      "invites.revoke": "招待を失効",
    },
  ],
  models: [
    "モデル・単価・APIキー",
    {
      "models.read": "現在のモデル・単価・キーの設定状態",
      "models.put": "モデル・推論量・単価を変更",
      "credentials.put": "APIキーを設定",
    },
  ],
  limits: [
    "call上限・共有枠",
    {
      "responseLimits.read": "応答生成1回の上限",
      "responseLimits.put": "call回数上限を変更",
      "playPolicy.read": "手番のコール枠・受領判断期限",
      "playPolicy.put": "手番のコール枠・受領判断期限を変更",
      "modelLimits.read": "モデルの共有枠",
      "modelLimits.put": "共有枠を変更",
    },
  ],
  costs: [
    "費用の計算額",
    {
      "costs.read": "費用の集計・明細・時系列・利用者/処理/モデル別",
      "playUsage.read": "生成申請・元案・消費SP・成立件数の日別集計",
    },
  ],
  runtime: [
    "メンテナンス・監視",
    {
      "runtime.read": "運用・通知先の状態",
      "runtime.put": "運用停止・並行数・監視を設定",
      "monitorWebhook.put": "通知先Webhookを設定",
      "monitor.samples": "監視の標本",
      "monitor.notifications": "通知の履歴",
    },
  ],
  jobs: [
    "ジョブ",
    {
      "jobs.list": "ジョブ一覧",
      "jobs.read": "ジョブの詳細",
      "jobs.resume": "保存状態から再開",
      "playSessions.list": "進行中のプレイの手番",
      "playSessions.advance": "止まった手番を保存状態から進める",
    },
  ],
  backups: [
    "バックアップ・復元",
    {
      "backups.read": "バックアップの設定状態",
      "backups.configure": "保存先・日程・暗号化を設定",
      "backups.list": "スナップショット一覧",
      "backups.create": "バックアップを取得",
      "backups.restore": "スナップショットを復元",
      "backups.jobs": "取得・復元の進捗一覧",
      "backups.job": "取得・復元の進捗",
    },
  ],
  mcp: [
    "MCP接続・認可",
    {
      "mcp.clients.list": "登録クライアント一覧",
      "mcp.clients.put": "クライアントを登録・変更",
      "mcp.grants.list": "本人が許可した認可一覧",
      "mcp.grants.revoke": "認可を失効",
    },
  ],
  audit: [
    "操作監査・受付確認",
    { "audit.list": "操作監査", "requests.read": "要求IDから受付結果を確認" },
  ],
} as const;
export const userOperations = [
  "account.register",
  "account.claim",
  "worlds.join",
  "worlds.resumeJoin",
] as const;
export const editAfterRead: Partial<Record<Name, Name>> = {
  "inspection.select": "inspection.read",
  "inspection.settings": "inspection.configure",
  "inspection.evaluate": "inspection.evaluation",
  "worlds.list": "worlds.read",
  "worlds.read": "worlds.configure",
  "worlds.graph": "worlds.edit",
  "npcs.read": "npcs.put",
  "promotionPolicy.read": "promotionPolicy.put",
  "creationPolicy.read": "creationPolicy.put",
  "presets.list": "presets.put",
  "worldBudgets.read": "worldBudgets.put",
  "users.list": "users.role",
  "settings.read": "settings.invites",
  "invites.list": "invites.revoke",
  "models.read": "models.put",
  "responseLimits.read": "responseLimits.put",
  "playPolicy.read": "playPolicy.put",
  "reportPolicy.read": "reportPolicy.put",
  "modelLimits.read": "modelLimits.put",
  "runtime.read": "runtime.put",
  "jobs.list": "jobs.read",
  "jobs.read": "jobs.resume",
  "playSessions.list": "playSessions.advance",
  "backups.read": "backups.configure",
  "backups.list": "backups.restore",
  "backups.jobs": "backups.job",
  "mcp.clients.list": "mcp.clients.put",
  "mcp.grants.list": "mcp.grants.revoke",
};
export type Section = keyof typeof operations;
export const catalog: Partial<Record<Name, string>> = Object.assign(
  {},
  ...Object.values(operations).map((v) => v[1]),
);
export const readOnly = (name: string) =>
  name === "inspection.select" || isReadOnlyOperation(name);
export const schemas = Object.fromEntries(
  Operation.options.map((s) => [s.shape.operation.value, s]),
) as {
  [K in Name]: Extract<
    (typeof Operation.options)[number],
    { shape: { operation: z.ZodLiteral<K> } }
  >;
};
export const guidance: Partial<Record<Section, string>> = {
  reports:
    "送信枠はユーザーと世界ごとに日本時間の日付で集計します。初期値は1日10件、通常手番3回で1件、1件1,200文字です。端末認可後は未プレイ・参加完了前でも1日1件送れます。設定はいつでも変更でき、新しい送信へ反映します。報告はプレイヤーの申告で、世界の事実とは区別します。",
  inspection:
    "保存済みの提示記録を検品します。移動量は新情報の代理指標であり、満足度の実測ではありません。意味評価と原則適合は別に表示します。定期評価の予算は1回の対象抽出全体へ適用します。",
  worlds:
    "世界構築の画面では、日単位の進行・公開・参加受付・予算・プリセットも操作できます。直接編集は確定済みの世界と履歴を扱います。内部の読取は人物の観測になりません。",
  users:
    "追加した管理者にも任命権があります。最後の有効な管理者の降格・BANは拒否します。BAN中は新しい推論と世界確定を止め、解除後に保存状態から再開します。",
  models:
    "先に現在の設定を取得してください。モデル・単価は応答生成1回の間は同じ版を使い、次の応答から変更します。APIキーは書込み専用です。",
  limits:
    "call回数は同じ応答内の修正・再試行を通算します。シーンの長さや経過日数の上限ではありません。モデルの共有枠はサービス名:モデルIDで指定し、次のAPI送信から全ワーカーへ反映します。",
  costs:
    "使用量と保存済み単価から求めた計算額です。請求額ではありません。時刻はこのブラウザーのタイムゾーンで表示します。世界ID等の未指定は全件、明示的な未所属の指定はその記録のみを対象にします。",
  runtime:
    "運用停止では送信済みAPI応答を回収・保存し、次の推論と世界確定を止めます。閲覧と管理操作は継続できます。通知先と閾値を設定すると通知を開始します。",
  backups:
    "取得・復元ではログイン・閲覧を含む停止が発生します。送信済み応答を保存してから整合する一組を扱います。復元では選んだスナップショットの世界・認証・費用へ戻ります。進捗は受付時の要求IDで確認できます。",
  mcp: "callback・許可scope・対象世界を事前登録し、発行したclient IDを接続先へ設定してください。接続時は本人のログインと同意が必要です。クライアントの無効化・scope縮小・認可の失効は次の操作と確定に反映します。",
};
