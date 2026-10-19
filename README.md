# GESTALOKA v3

動的な自由記述シェアワールドを構築するプロジェクトです。
共通の世界更新Agent、時間指定の構築、別村民の生成、人間の自由記述行動を実装しています。Webから初期生成・試遊・追加進行・明示完了・別村民への参加を操作できます。村民の画面は、本人の観測・解釈と入力を表示します。

## ローカル起動

Node.js 22.14以上の22系または24系、pnpm 10.16.1、Linuxコンテナーを実行できるDocker Composeを使用します。

```powershell
pnpm install --frozen-lockfile
pnpm env:init
pnpm db:up
pnpm dev
```

Webは <http://127.0.0.1:5173> です。Viteが `/api` をAPIへ転送し、HTTPとSSEを同一オリジンで利用できます。API・Web・DBの公開ポートはループバックへ限定しています。`pnpm env:init` はランダムな開発用DB資格情報を `.env` に生成し、既存ファイルは上書きしません。手動設定する場合は `.env.example` を複製して空欄を埋めてください。資格情報の変更時は、永続化されたDBの資格情報も変更してください。

API・ワーカー・Webは、それぞれ `pnpm --filter @gestaloka/api dev`、`pnpm --filter @gestaloka/worker dev`、`pnpm --filter @gestaloka/web dev` でも起動できます。個別起動の前に `pnpm build:server` を実行してください。

`pnpm db:stop` はデータを残してDBを停止します。再起動は `pnpm db:up` です。Neo4j Community 5.26系とPostgreSQL 17をイメージのdigestで固定し、名前付きvolumeに永続化します。本番用の構成・公開認証は別途設計します。

## 構成と公開契約

- `apps/api`: FastifyのHTTP/SSEと公開スキーマの登録。
- `apps/worker`: APIとは独立したNode.jsプロセス。pg-bossで構築ジョブを取得し、共通Agentで進行。
- `apps/web`: React / Vite。サーバー内部への依存をESLintで拒否。
- `packages/contracts`: ブラウザーでも利用できる公開Zodスキーマと生成HTTP型。
- `packages/server`: サーバー用のDB・キュー・チェックポイント接続。

`pnpm generate` は公開Zodスキーマを登録したFastifyからOpenAPIを取得し、openapi-typescriptでHTTPクライアント型を生成します。OpenAPIやクライアント型は直接編集しません。SSEのデータも公開Zodスキーマで実行時検証します。疎通用SSEは一つのメッセージで終了し、世界ごとの進捗SSEは保存済みIDからの再送に対応します。

## DeepSeekによる初期生成

`.env` に `DEEPSEEK_API_KEY` を設定します。指定バージョンDeepSeek-V4.1-Flash-1017のAPI識別子は `deepseek-flash` です。接続先は `https://api.deepseek.com` を使います。

```powershell
pnpm llm:probe
pnpm world:generate --prompt examples/village.txt
pnpm world:generate --resume <runId>
```

初期入力はファイルから読み込み、エンジン内の固定設定にはしません。生成候補の構造・接続を検証し、Neo4jへの確定とPostgreSQLの構築記録・LangGraphチェックポイントを関連づけます。`ready` はT0の成立を表し、管理者による世界構築完了とは区別します。再取得だけでは生成や観測を再実行しません。構造検査の成功は意味的な整合性の証明ではありません。

`LLM_BUDGET_ID` が実測全体の費用を集計し、既定の上限は今回承認された40ドルです。PostgreSQLで送信前の予約と応答後の精算を行い、再開・別プロセスでも共有します。単価は2026-10-19に確認したFlashのピーク料金を使うため、表示額は請求額そのものではなく上限見積です。応答喪失時は予約を残し、同じ呼出しIDを自動再送しません。上限や応答未確定による停止は実行上の保留であり、世界内の失敗ではありません。

1回の最大出力は接続確認で16,384トークン、初期生成で65,536トークンです。`LLM_MAX_OUTPUT_TOKENS` で設定でき、予約額にも反映します。キーと内部推論は実測記録へ保存しません。サーバー側の入出力・使用量・遅延はPostgreSQL、生成の確認記録はローカルの `artifacts/evaluations/` に保存します。

実測結果は [初期生成の確認記録](documents/evaluations/deepseek-initial-world-2026-10-19.md) を参照してください。

## 共通の世界更新

```powershell
pnpm world:act --build <buildRunId> --action examples/greet-village-leader.txt --at 0 --until 60000
pnpm world:act --build <buildRunId> --actor <existenceId> --at 5000 --until 60000
pnpm world:act --resume <operationId>
```

世界内時間はT0からのミリ秒です。行動ファイルを省略すると、指定した主体の観測・解釈だけから意図を形成します。世界更新Agentは共有グラフを照会し、候補を検証・確定します。管理者向けCLIの要約と、主体が取得できるviewは分けて出力し、ローカルの `artifacts/world-operations/` に保存します。管理情報を含むCLI出力を、そのままプレイヤーへ公開する用途には使いません。

再開は保存済みの結果とreceiptを確認します。応答不明の予約は保持し、同じ呼出しを自動再送しません。保留の再開は新しい未確定処理を始める場合があります。初期生成と同じ予算を通算します。主体の知識・実行世代・候補の扱いは [ADR-002](documents/adr/ADR-002-world-agent.md)、失敗例を含む確認結果は [世界更新の実測記録](documents/evaluations/world-agent-2026-10-19.md) を参照してください。

## 時間指定の世界構築

別のターミナルで `pnpm --filter @gestaloka/worker dev` を起動し、次の管理者用CLIを使います。モデルのAPIキーが必要です。受付コマンドはジョブを保存して返り、ブラウザーやCLIを閉じてもワーカーが処理します。

```powershell
pnpm world:build create --prompt examples/village.txt
pnpm world:build show --id <constructionId>
pnpm world:build advance --id <constructionId> --days 1
pnpm world:build show --id <constructionId>
pnpm world:build advance --id <constructionId> --days 1
pnpm world:build finish --id <constructionId>
pnpm world:build join --id <constructionId>
pnpm world:build act --id <constructionId> --action examples/greet-neighbor.txt
pnpm world:build resume --id <constructionId>
```

`advance`はreadyの区切りから、`--days`で指定した日数を追加します。管理者の指定は最小1日、1日単位です。内部ではミリ秒で時点を保持し、1日未満の相互作用も処理します。構築中は各人物が本人の知識から期間の活動方針を形成し、日常や短いやり取りをまとめ、重要な変化で方針を見直します。追加期間では継続意図を保って新しい方針を形成します。詳細は [ADR-007](documents/adr/ADR-007-construction-activity-plans.md) を参照してください。

`finish`はその区切りで構築を完了し、`join`は別の新しい村民を共通Agentで生成します。試遊村民の存在・履歴・所有・知識は残ります。`resume`はpausedの処理を再開します。目標未到達の保留を、構築完了として扱いません。人間の自由記述行動は、期間方針による要約を適用せず、次の本人の判断場面まで進めます。

`act`は参加した人間の村民へファイルの行動文を渡します。期間は指定せず、NPCの判断を必要に応じて挟み、次に人間の判断が必要になる場面まで進めます。人間の次の意図をAIで形成しません。継続中の活動は保持し、途中保留の再開にも同じ保存記録を使います。

取得結果は到達時刻・目標時刻・主な処理記録・未処理の起動を含む管理情報です。区間をまたぐ継続と参加の契約は [ADR-003](documents/adr/ADR-003-construction-lifecycle.md)、実行結果と時間配分の残る問題は [構築の実測記録](documents/evaluations/construction-2026-10-19.md) を参照してください。

## 管理APIと公開知識

APIとワーカーを起動し、同じオリジンから利用します。初回の `POST /api/session` で発行するHttpOnly Cookieがローカルの操作主体を識別します。変更操作には `X-Gestaloka-Request: 1` を付け、世界の作成・構築操作には再送用のrequestIdを指定します。

`/api/worlds` で自分の世界を作成・取得し、`/api/worlds/:id/commands` で期間追加・再開・完了・参加を受け付けます。受付とpg-boss投入は同時保存され、202の後はワーカーで実行します。`/records` は管理者向けの報告、`/knowledge` は割り当てた村民本人の観測・解釈だけを返します。履歴は1ページ50件で、nextから続きを取得できます。

`/api/worlds/:id/actions` は自由記述のactionTextとrequestIdを受け付けます。操作対象はサーバー側の割当で決め、actorIdの自己申告は受け付けません。受付結果のrunIdから `/api/runs/:id` で本人の入力・到達時刻・処理状態を取得でき、`/api/worlds/:id/play/resume` で途中保留を再開できます。入力の受付と世界内の成功は区別します。

`/api/worlds/:id/events?role=admin` または `role=player` は、現在の権限を確認して更新通知を配信します。Last-Event-IDによる再送に対応し、別の主体・世界・ロールのcursorは拒否します。取得や再接続だけで世界内の観測は追加しません。CLIで作った世界へブラウザーの権限を自動付与しません。詳細は [ADR-004](documents/adr/ADR-004-world-api.md) を参照してください。

同時刻の意図と人間への操作返却は [ADR-005](documents/adr/ADR-005-human-play.md)、待ち時間と推論量の比較は [通常行動の実測](documents/evaluations/human-play-2026-10-19.md) を参照してください。`LLM_REASONING_EFFORT`で通常行動、`LLM_INITIAL_REASONING_EFFORT`で初期生成の推論量を指定できます。値はnone・low・high・max、コードの既定値は両方highです。同じ呼出しIDの保存済み設定と応答は保持し、新しい呼出しから設定を適用します。

画面は [ADR-006](documents/adr/ADR-006-gameplay-ui.md) に従います。受付後の再読込で行動を追加送信せず、保存されたrunIdの入力と進行へ戻ります。履歴は前後へ取得でき、保持は4ページ、描画は表示範囲に絞ります。過去を読んでいる間の更新では位置を移動しません。通信の再接続時は、配信位置と公開状態を取得し直します。

`pnpm llm:compare --operation <operationId> --effort low` は完了済みの最終入力で候補を再生成し、構造と時間・使用量を記録します。差分を世界へ確定せず、同じ予算で通算します。一つの候補の構造検査を、意味的な品質や通常プレイ全体の保証にはしません。

## 検証

```powershell
pnpm check
pnpm db:up
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm check` は生成物の整合性、tscの型検査、lint、整形、単体・コンポーネントテスト、ビルドを実行します。Viteビルドとは別に型検査します。生成物の変更後は `pnpm generate` を実行してください。

統合テストは実DBを使い、Neo4jの再接続後の読取、PostgreSQLトランザクション内のキュー投入のロールバック、LangGraphの中断・再開と保存済みtaskの再利用を確認します。ブラウザーテストは専用の実API・独立ワーカー・DBとテスト用モデル応答を使い、構築から通常行動・再読込・長い履歴まで確認します。専用キューと予算を使用し、外部LLMへ送信しません。

物語・行動結果の固定を検証の合格条件にしません。共有グラフの保存・確定・履歴と検証範囲は [ADR-001](documents/adr/ADR-001-world-graph.md) を参照してください。実モデルの品質・時間・費用と残る課題はdocuments/evaluationsに記録します。

## 設計資料

作業・設計の原則は [AGENTS.md](AGENTS.md)、視覚ルールは [DESIGN.md](DESIGN.md) にあります。実装対象は [#25](https://github.com/KingYoSun/gestaloka/issues/25) と関連Issueです。この開発基盤は [#29](https://github.com/KingYoSun/gestaloka/issues/29) の最初の実装単位です。

公開契約は [Fastify Zod provider](https://github.com/fastify/fastify-type-provider-zod)、疎通配信は [Fastify SSE](https://github.com/fastify/sse)、チェックポイントの再利用は [LangGraph Functional API](https://docs.langchain.com/oss/javascript/langgraph/functional-api) の仕様に従います。TypeScriptはtypescript-eslintとopenapi-typescriptの両方の対応範囲に合わせて5.9.3へ固定しています。
