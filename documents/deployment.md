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

利用者画面は`https://play.example.com`、管理画面は`https://admin.example.com`、認証・API・MCPの入口は`https://api.example.com`となる。ブラウザー向けURLとOry内部接続先を分け、認証フローのフォーム・戻り先・発行者には公開HTTPS URLを使う。OryのCookieはこの環境の親ドメインに限定する。MCPクライアントの登録と権限は#72で共通APIへ接続する。

## 秘密情報

生成した設定と制御用の永続ボリュームは管理者だけが読める場所に置く。設定ファイルをGitやイメージへ含めない。モデルのAPIキー、監視Webhook、バックアップ認証情報は保存時に暗号化し、通常の取得APIへ返さない。

制御サービスだけがDocker socketを持つ。この権限はホストの管理権限に相当する。公開ポートを作らず、APIからは専用トークン付きの内部接続だけを受け付ける。アプリとワーカーにはDocker socketを渡さない。

バックアップ保管先は環境専用のS3バケットまたはprefixとし、公開環境ではHTTPSを使う。S3認証情報とResticのパスワードは別の安全な場所にも保存する。アプリの暗号鍵はバックアップの中へ含めるが、そのバックアップを開くパスワードは含めない。

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

設定は`enabled`、`intervalHours`、`retentionDays`、`repository`、`accessKey`、`secretKey`、`password`、`region`を持つ。未設定では取得しない。初期運用は24時間ごと、30日保持とし、`enabled: true`にしてから定期取得を始める。実行済みの分は暗号化してS3へ送り、同じ配置の保持期間外のスナップショットを整理して保管データを検証する。

管理画面とMCPは#73と#72でこのAPIへ接続する。サーバー上では`pnpm production controller <設定ディレクトリ> <操作JSONファイル>`でも操作できる。これはOSの管理権限による復旧手段で、実行者を`null`、理由と結果を独立した制御記録へ保存する。操作JSONには`requestId`も指定できる。秘密値を含むJSONファイルは権限を制限し、設定後に削除する。

## 取得と復元の境界

取得時は新たな推論・世界確定を停止し、ログイン・閲覧・管理操作の入口も止める。ワーカーは送信済みAPI応答と計算額を保存し、次の推論・確定の前で保留する。応答の回収が終わってからワーカー、Ory、Neo4jを停止する。回収を待つ間はジョブの進捗を制御サービスに残す。

取得する一組は次のとおり。

| 対象                                | 保存する内容                                                       |
| ----------------------------------- | ------------------------------------------------------------------ |
| アプリのPostgreSQL全体              | 権限、監査、費用記録、処理の途中状態、シーン、チェックポイント     |
| KratosとHydraのPostgreSQL           | Identity、連携済みログイン方法、OAuthクライアントと鍵              |
| 停止したNeo4jのデータボリューム     | 共有グラフ、履歴、receipt、内部認証情報                            |
| 実行用・Caddyのボリュームと必要な鍵 | dshの継続文脈、証明書データ、アプリ・Ory・Neo4jの復号に必要な鍵    |
| manifest                            | 形式版、取得元、時点、各ファイルのハッシュ、停止前の状態と実行対象 |

一組をローカルで取得できたらサービスを再開し、暗号化送信を行う。停止前に処理中だった対象は保存状態から再開する。もともと保留していた処理は勝手に再開しない。未確定のAPI送信は予約額を残し、自動再送しない。

復元は保管データとファイルの検証を終えてから書き換えを始める。復元先の配置名、ドメイン、S3接続、制御トークン、PostgreSQL接続用パスワードは維持し、アプリ・Ory・Neo4jの復号に必要な鍵を復元する。別ドメインへの復元ではCaddyの証明書を持ち込まない。APIの起動後、receiptを使う既存の再開処理でDB間の確定差異を照合する。

復元したら`pnpm production sync <設定ディレクトリ>`を実行して、制御サービスが復元した鍵をホストの設定へ同期する。その後の再配備には同期後の設定を使う。公開環境へ戻す前に、Identity、権限、参加対象、シーン、費用、未確定送信を確認する。

## 失敗時

処理中のサービス停止や制御サービスの再起動が起きた場合は、進捗とジョブIDを残し、同じ復元を自動でやり直さない。復元中の失敗では、新しい要求IDと理由で同じスナップショットから復元し直す。必要な設定の修正と再復元以外の処理は止める。

取得だけが失敗してサービスが停止した場合は、`pnpm production recover <設定ディレクトリ> <ジョブID>`で停止前の状態へ戻せる。復元の途中で失敗したデータにはこの操作を使わない。制御サービスにも接続できないときは、サーバー管理者がDockerと制御用ボリュームの状態を確認する。制御用ボリュームを消したり、古いアプリDBで上書きしたりしない。

初代管理者の復旧には既存の`ops:recover-admin`と同じ専用CLIを公開環境のAPIコンテナ内で使う。最後の有効な管理者を画面から降格・BANすることはできない。
