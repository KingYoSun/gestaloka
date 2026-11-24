# 公開配置と復旧

#71の構成はLinux1台、Docker Compose、Caddyを前提とする。公開先の契約や実際のDNS設定は含まない。`pnpm test:recovery`で空の隔離環境への取得・復元を再現できる。テストは模擬応答を使い、有料モデルを呼ばない。

## 配置と初回公開

公開するのはCaddyの80/443だけとし、DB、Ory管理API、復旧用の制御サービスにはホストのポートを割り当てない。アプリとOryの外向き通信は専用ネットワークを使う。`mode: testing`ではその通信を遮断する。HTTPS入口は別のネットワークで受け付ける。

設定ディレクトリは環境ごとに作る。開発環境の`.env`・`.env.ory`・Identity・DB・鍵は読み込まない。配置名に開発用の`gestaloka-v3`は使えない。

1. LinuxにDocker Engine、Compose、Node.js、pnpmを用意し、リポジトリを配置する。
2. 次の内容を`profile.json`として用意する。`accessCidrs`は初代管理者が接続するIPだけにする。DNSの`play`、`admin`、`api`を同じサーバーへ向け、80/443を開く。

   ```json
   {
     "name": "gestaloka-production",
     "domain": "example.com",
     "mode": "production",
     "httpPort": 80,
     "httpsPort": 443,
     "accessCidrs": "203.0.113.10/32"
   }
   ```

3. `pnpm production init .deployments/production profile.json`を実行する。生成した`deployment.env`に公開環境専用のGoogle/Xの値を設定する。Googleは`https://api.example.com/self-service/methods/oidc/callback/google`、Xは同じパスの末尾を`twitter`とする。XはOAuth 1.0aのAPI Key/Secretを使う。
4. `pnpm production build .deployments/production`、`pnpm production up .deployments/production`を実行する。Caddyが証明書を取得する。
5. `https://api.example.com/auth/login`から本人がログインして利用登録する。最初の1人だけが初代管理者になり、その後は招待制となる。管理者はモデル、単価、上限、世界予算を設定する。開発費100ドルは公開環境の予算に流用しない。
6. Google/X双方のログイン、ログアウト、管理者の権限、管理画面を確認する。公開するときは`profile.json`の`accessCidrs`を公開対象へ変更し、`pnpm production render .deployments/production`の後に同じ`up`を実行する。

利用者画面は`https://play.example.com`、管理画面は`https://admin.example.com`、認証・API・MCPの入口は`https://api.example.com`となる。ブラウザー向けURLとOry内部接続先を分け、認証フローのフォーム・戻り先・発行者には公開HTTPS URLを使う。OryのCookieはこの環境の親ドメインに限定する。MCPクライアントの登録と権限は[管理MCP](mcp.md)を参照する。

## 外部プロキシ経由の公開

外部のリバースプロキシで公開HTTPSを受ける構成では、`profile.json` の `httpsPort` に利用者から見えるポートを指定します。Caddyを同じホストからだけ利用する場合は、配置先の `deployment.env` に次の値を設定し、通常の `render`・`build`・`up` で反映できます。

```dotenv
CADDY_BIND_ADDRESS=127.0.0.1
CADDY_HTTP_PORT=28080
CADDY_HTTPS_PORT=28443
CADDY_TLS_MODE=internal
```

`CADDY_TLS_MODE=internal` ではCaddyの内部CAが証明書を発行します。前段のプロキシにはそのCAを信頼する設定が必要です。`auto` はCaddyの自動HTTPSを使います。未指定時は本番で `auto`、試験環境で `internal` です。待受の指定を省くと、ポートはプロファイルの値、アドレスは本番で `0.0.0.0`、試験環境で `127.0.0.1` になります。再描画で生成される `BIND_ADDRESS`・`HTTP_PORT`・`HTTPS_PORT` はComposeが読み取ります。

## NPC手番を引き継ぐデプロイ

`pnpm production up` は、稼働中の旧ワーカーへ新しいNPC手番の受付停止を求める。処理中の手番があれば、モデル応答と手番の確定を待ってからコンテナを交換する。4分以内に準備が整わなければ終了コード75を返す。旧ワーカーは処理を続け、遅れて届いた応答も保存する。

Compose を直接呼ぶ配置スクリプトでは、`docker compose ps --status running -q worker` で得たコンテナIDと Compose の引数を `node apps/worker/dist/deployment.js compose "$worker" …` に渡す。新規起動時のIDは空文字列でよい。終了コード75のときは交換前なので、旧コンテナを再作成せずに配置を見送る。イメージを戻す際の交換にも同じ手順を使う。準備完了ログをパイプで確認する場合は `grep -F 'World construction worker ready' >/dev/null` で最後まで読む。

停止準備に未対応の旧版が稼働中の場合も75で終了する。初回は、実行中の処理を完了させて旧ワーカーを停止した状態で新版を起動する。

## 判断モデル

同じ手番でダイスに失敗した申請の出し直しを見分けるには、配置先の `deployment.env` に判断モデルを設定し、`api` と `worker` を作り直します（[ADR-061](adr/ADR-061-decision-model-and-repeated-applications.md)）。キーは管理画面に保存したOpenRouterのキーを使います。空欄なら判断APIを呼びません。

```dotenv
LLM_DECISION_MODEL=typesafe/jev-1.14
LLM_DECISION_REPEAT_THRESHOLD=0.80
```

## 秘密情報

生成した設定と制御用の永続ボリュームは管理者だけが読める場所に置く。設定ファイルをGitやイメージへ含めない。モデルのAPIキー、監視Webhook、バックアップ認証情報は保存時に暗号化し、通常の取得APIへ返さない。

制御サービスだけがDocker socketを持つ。この権限はホストの管理権限に相当する。公開ポートを作らず、APIからは専用トークン付きの内部接続だけを受け付ける。アプリとワーカーにはDocker socketを渡さない。

バックアップ先には環境専用のS3バケット・prefixか、配備先ホスト内の保存領域を指定する。公開環境からS3へ接続する場合はHTTPSを使う。S3認証情報とResticのパスワードは別の安全な場所にも保存する。バックアップにはアプリの暗号鍵を含める。Resticのパスワードは別途保管する。

## 運用API

バックアップもほかの運用操作と同じ`Operations.execute`を使う。本人の管理者権限、BAN、要求IDと内容の一致を確認し、理由と結果を監査へ残す。受付をDBへ確定してから制御サービスで処理を始める。同じ要求IDの再送で取得・復元を繰り返さない。

| 操作                | 内容                                                             |
| ------------------- | ---------------------------------------------------------------- |
| `backups.read`      | 設定版、保管先、間隔、保持期間、実行中かを取得。秘密値は返さない |
| `backups.configure` | 設定全体と秘密値、`expectedVersion`、理由を指定                  |
| `backups.create`    | 理由を指定して取得を要求し、ジョブIDを受け取る                   |
| `backups.list`      | スナップショットを50件ずつ取得。`before`に返された`next`を渡す   |
| `backups.jobs`      | 取得・復元・設定のジョブを50件ずつ取得                           |
| `backups.job`       | ジョブIDで段階、完了・失敗、操作した人と理由を取得               |
| `backups.restore`   | 一覧の完全なスナップショットIDと理由を指定して復元               |

設定には`enabled`、`intervalHours`、`retentionDays`、`repository`、`password`を指定する。S3を使う場合は`repository`に`s3:`で始まる保存先を指定し、`accessKey`、`secretKey`、`region`を加える。ホスト内の保存は`repository: "local"`で指定する。管理画面では「配備先ホスト内」を選ぶ。`enabled: true`にすると定期取得を始める。手動取得は保存先を設定すれば利用できる。取得時は暗号化し、同じ配置の保持期間外のスナップショットを整理して保管データを検証する。

管理画面の`/operations/backups`とMCPも同じAPIを使う。サーバー上では`pnpm production controller <設定ディレクトリ> <操作JSONファイル>`でも操作できる。これはOSの管理権限による復旧手段で、実行者を`null`、理由と結果を独立した制御記録へ保存する。操作JSONには`requestId`も指定できる。秘密値を含むJSONファイルは権限を制限し、設定後に削除する。

## メンテナンス中の配備と管理修正

1. `paused: true` で、管理修正の期限を指定していない状態にする。S3未設定の旧版でホスト内保存を使う場合は、先に `pnpm production backup-controller <設定ディレクトリ>` でバックアップ制御サービスだけを更新する。同じホストで運用コマンド `backups.configure` を実行し、`repository: "local"` を設定する。
2. `backups.create` を実行する。ジョブの完了と `backups.list` のスナップショットIDを確認してから、`pnpm production build` と `pnpm production up` で全体を更新する。先に全体をビルドすると、バックアップ後のサービス再起動で新しいイメージが使われることがある。ホスト内のスナップショットは同じホストでの配備・データ修正の復元点として使える。ホスト障害に備える場合は外部の保存先を使う。
3. 新版の起動と既存履歴の読み取りを確認する。`paused: true` のまま `worldEditsUntil` を指定し、対象を読み直して依存版と理由付きで管理修正を確定する。修正後に対象を再読し、期限を外す。プレイヤー向けに公開する準備ができたら `paused` を解除する。

旧版へ切り戻す場合は、新版で `worldEditsUntil` を外してから切り替える。反映前のデータに戻す場合は、手順2で確認したスナップショットを使う。

## 取得と復元の境界

取得時は新たな推論・世界確定を停止し、管理修正の期限を外す。ログイン・閲覧・管理操作の入口も止める。ワーカーは送信済みAPI応答と計算額を保存し、次の推論・確定の前で保留する。応答の回収が終わってからワーカー、Ory、Neo4jを停止する。回収を待つ間はジョブの進捗を制御サービスに残す。取得前から運用を停止していた場合は、取得後も停止を保つ。

取得する一組は次のとおり。

| 対象                                | 保存する内容                                                       |
| ----------------------------------- | ------------------------------------------------------------------ |
| アプリのPostgreSQL全体              | 権限、監査、費用記録、処理の途中状態、シーン、チェックポイント     |
| KratosとHydraのPostgreSQL           | Identity、連携済みログイン方法、OAuthクライアントと鍵              |
| 停止したNeo4jのデータボリューム     | 共有グラフ、履歴、receipt、内部認証情報                            |
| 実行用・Caddyのボリュームと必要な鍵 | 実行用ファイル、証明書データ、アプリ・Ory・Neo4jの復号に必要な鍵   |
| manifest                            | 形式版、取得元、時点、各ファイルのハッシュ、停止前の状態と実行対象 |

一組を取得できたらサービスを再起動し、設定先へ暗号化して保存する。もとの運用設定が稼働中であれば、停止前に処理中だった対象を保存状態から再開する。未確定のAPI送信は予約額を残し、自動再送しない。

復元は保管データとファイルの検証を終えてから書き換えを始める。復元先の配置名、ドメイン、バックアップ先の接続、制御トークン、PostgreSQL接続用パスワードは維持し、アプリ・Ory・Neo4jの復号に必要な鍵を復元する。別ドメインへの復元ではCaddyの証明書を持ち込まない。APIの起動後、receiptを使う既存の再開処理でDB間の確定差異を照合する。取得時か復元開始時に運用停止中だった場合は、復元後も停止を保つ。

復元したら`pnpm production sync <設定ディレクトリ>`を実行して、制御サービスが復元した鍵をホストの設定へ同期する。その後の再配備には同期後の設定を使う。公開環境へ戻す前に、Identity、権限、参加対象、シーン、費用、未確定送信を確認する。

## 失敗時

処理中のサービス停止や制御サービスの再起動が起きた場合は、進捗とジョブIDを残し、同じ復元を自動でやり直さない。復元中の失敗では、新しい要求IDと理由で同じスナップショットから復元し直す。必要な設定の修正と再復元以外の処理は止める。

取得だけが失敗してサービスが停止した場合は、`pnpm production recover <設定ディレクトリ> <ジョブID>`で停止前の状態へ戻せる。復元の途中で失敗したデータにはこの操作を使わない。制御サービスにも接続できないときは、サーバー管理者がDockerと制御用ボリュームの状態を確認する。制御用ボリュームを消したり、古いアプリDBで上書きしたりしない。

初代管理者の復旧には既存の`ops:recover-admin`と同じ専用CLIを公開環境のAPIコンテナ内で使う。最後の有効な管理者を画面から降格・BANすることはできない。
