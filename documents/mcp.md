# 管理MCP

管理者がクライアントを事前登録し、本人がOryでログイン・同意してから利用する。MCPの認可仕様は2026-07-28、SDKは`@modelcontextprotocol/server`・`client`の2.3.1を使う。HTTPの入口は`/mcp`。アプリの運用処理を呼び出す構成とし、MCP専用の世界確定経路は作らない。

## 登録と接続

管理者は共通APIの`mcp.clients.put`へ次の値を渡す。初回の`expectedVersion`は0、変更時は`mcp.clients.list`で得た版を使う。`clientId`には新しいUUIDを指定する。

```json
{
  "operation": "mcp.clients.put",
  "clientId": "生成したUUID",
  "expectedVersion": 0,
  "reason": "世界の説明と費用確認に利用",
  "configuration": {
    "name": "手元のLLM",
    "enabled": true,
    "redirectUris": ["http://127.0.0.1:18984/callback"],
    "scopes": ["worlds.list", "worlds.read", "worlds.graph", "costs.read"],
    "worldIds": null
  }
}
```

callbackは接続するクライアントが指定する値に合わせる。クライアント側にはMCPのURL、発行したclient ID、必要なscopeを設定する。公開環境のURLは`https://api.<ドメイン>/mcp`、開発環境は`http://127.0.0.1:3000/mcp`となる。公開クライアントとして認可コードとPKCE S256を使い、client secretは発行しない。

接続に必要なscopeは`mcp.connect`。操作には、登録した範囲内でその操作のscopeも必要となる。初回の検出で接続用scopeだけを要求したクライアントには、操作時にHTTP 403と`WWW-Authenticate`で追加のscopeを示す。追加の本人同意後は、同じ業務要求IDで再送できる。自動登録口は有効にしない。

本人の同意画面はクライアント名、要求scope、対象の世界を示す。一般ユーザー、BANされた人、無効なクライアント、登録外のscope・リソースは管理MCPを利用できない。認証・同意は操作の成功を意味せず、世界構築等の受付後は返されたIDでジョブの状態を確認する。

## API・ツール・scopeの対応

共通操作はすべて`POST /api/operations`で扱う。MCPでは同じ操作名の`.`を`_`に置き換えたツールを公開し、scopeには元の操作名を使う。契約の`Operation.options`から全ツールを生成し、試験で一覧の一致を確認する。入力から`operation`を除き、`requestId`を付けて呼び出す。

| 対象                       | 共通操作の例                                                          | MCPツールの例                                                         |
| -------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 世界構築・進行・履歴       | `worlds.create`、`worlds.command`、`worlds.records`                   | `worlds_create`、`worlds_command`、`worlds_records`                   |
| グラフの読取・管理修正     | `worlds.graph`、`worlds.edit`                                         | `worlds_graph`、`worlds_edit`                                         |
| 公開・参加・プリセット     | `worlds.configure`、`worlds.join`、`presets.put`                      | `worlds_configure`、`worlds_join`、`presets_put`                      |
| 費用・設定・上限           | `costs.read`、`models.put`、`worldBudgets.put`                        | `costs_read`、`models_put`、`worldBudgets_put`                        |
| ユーザー・任命・招待・監査 | `users.ban`、`users.role`、`invites.create`、`audit.list`             | `users_ban`、`users_role`、`invites_create`、`audit_list`             |
| ジョブ・停止・監視・通知   | `jobs.resume`、`runtime.put`、`monitor.samples`、`monitorWebhook.put` | `jobs_resume`、`runtime_put`、`monitor_samples`、`monitorWebhook_put` |
| バックアップ・復元         | `backups.create`、`backups.restore`、`backups.job`                    | `backups_create`、`backups_restore`、`backups_job`                    |
| MCPの登録・許可管理        | `mcp.clients.put`、`mcp.grants.revoke`                                | `mcp_clients_put`、`mcp_grants_revoke`                                |

読取、設定、実行、復元、任命にはそれぞれのscopeを指定する。管理者という理由で不足するscopeを補わない。秘密情報の変更も書込専用の共通APIを使い、キー・バックアップのパスワード・Webhookの秘密値を読取結果へ含めない。費用は使用量と適用単価からの計算額であり、請求額ではない。

`worldIds: null`は世界を限定しない設定、配列は許可する構築セッションのIDを表す。限定時に指定できるのは世界の参照・編集・進行・参加・公開管理、世界予算、費用、ジョブのscopeとなる。費用・ジョブの一覧は、許可された`worldId`で絞って取得する。新しい世界の作成とサービス全体の運用操作には、世界を限定しないクライアントを使う。

## 読取と直接編集

`worlds.read`で世界を確認し、`worlds.graph`でノード、関係、履歴、receiptを取得する。ノードと関係のIDを起点に必要な範囲を辿る。一覧は50件ずつ返し、`next`を次の`after`へ渡して続きを取得する。ノード参照が`null`でも、不存在や否定が世界内で確定したことにはならない。

編集時は読取結果の`dependencies`、変更差分`changes`、時点`at`、理由を`worlds.edit`へ渡す。ノードの改訂と関係の終了には、その対象を読んだ依存版が必要となる。型、接続、関係の意味を検証し、競合した場合は確定せずに再取得を求める。過去の履歴は保持し、新しい出来事・関係を改訂時点より前へ挿入しない。

これは管理者が提出する修正であり、人物の行動を代行する処理ではない。内部の指示・読取・推論を世界内の`see`・`interpret`へ自動保存しない。編集者、理由、差分、確定ID、要求のハッシュをreceiptと監査に残す。グラフ確定後に通信が切れても、同じ要求IDと内容で再送すれば保存済みの確定を使う。

## 失効と再開

MCP要求ごとにHydraのトークンの有効性、対象リソース、クライアント、本人、scopeを確認する。接続後のBAN・降格・クライアント無効化・scope縮小・許可取消を反映する。`mcp.grants.list`で本人の同意による許可を確認し、`mcp.grants.revoke`で取り消す。クライアント全体を止める場合は`mcp.clients.put`の`enabled`を`false`にする。

受付済みの世界処理にも許可を対応付け、失効後は次の推論・世界確定を止める。送信済み応答と費用は保存する。管理者が新しい認可で`jobs.resume`を実行した場合は、元の利用者の資格を確認した上でその認可を使い、保存済み処理から再開する。バックアップによる一時停止からの自動再開では元の認可も確認し、失効した許可を復活させない。

業務要求の再送には同じ`requestId`を使う。受け付けた内容と異なる再利用は拒否し、同じ操作の受付・確定・費用を重ねない。監査には操作した人に加え、MCPクライアントと許可のIDを残す。

`requests_read`は`id`で本人の要求の受付結果を照会する。`requests.read`と元の操作の両方のscopeが必要となる。未受付・受付待ち・受付済み・失敗を区別し、秘密値と元の入力を返さない。管理画面の操作と再読み込み後の確認は[管理画面の操作](operations-auth.md#管理画面の操作)を参照する。

## 検証

`pnpm test:integration`でscope・対象・失効・編集・履歴・再送を、`pnpm test:auth`で実Hydraの事前登録・PKCE・本人同意・トークン失効を確認する。`pnpm test:recovery`は公開用HTTPS構成で実Hydraのトークンを使い、SDKのMCPクライアントからバックアップの設定・取得・一覧・復元を行う。空の隔離環境へ戻し、Identity・権限・世界・費用・保存済みシーンを確認する。試験では有料モデルを呼ばない。

公式仕様: [MCP認可](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)、[TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)、[Fastify連携](https://ts.sdk.modelcontextprotocol.io/v2/serving/fastify.html)。
