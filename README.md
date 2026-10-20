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

## モデルの接続設定

`.env` の `LLM_MODEL` で基本モデルを、`LLM_RESOLUTION_MODEL` で結果提案・確定判断を担当する上位モデルを指定します。モデルIDは固定リストに制限しません。各サービスが返す利用可能なIDを指定してください。キーの値はチャットへ送らず、ローカルの `.env` に記入します。

| LLM_MODEL          | APIキー             | endpoint設定         | 既定のbase URL                                            |
| ------------------ | ------------------- | -------------------- | --------------------------------------------------------- |
| `deepseek-flash`   | `DEEPSEEK_API_KEY`  | `DEEPSEEK_BASE_URL`  | `https://api.deepseek.com`                                |
| `gemini-3.8-flash` | `GEMINI_API_KEY`    | `GEMINI_BASE_URL`    | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `gpt-6-luna`       | `OPENAI_API_KEY`    | `OPENAI_BASE_URL`    | `https://api.openai.com/v1`                               |
| ClaudeのモデルID   | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` | `https://api.anthropic.com/v1`                            |

endpointには `/chat/completions`・`/responses`・`/messages` を付けません。末尾の `/` はどちらでも使えます。ClaudeはAnthropic Messages API、OpenAIは既定でChat Completionsを使います。Responses APIを使うモデルには `OPENAI_API=responses` または対象側の `LLM_RESOLUTION_API=responses` を指定します。

Gemini 3.8 Flash／lowを使う場合は、次の値を設定します。既存行があれば置き換えてください。キーの値はチャットへ送らず、ローカルの `.env` に記入します。

```dotenv
LLM_MODEL=gemini-3.8-flash
GEMINI_API_KEY=<APIキー>
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
GEMINI_REASONING_EFFORT=low
GEMINI_INITIAL_REASONING_EFFORT=low
```

GPT-6 Luna／lowの場合は、次の値を設定します。

```dotenv
LLM_MODEL=gpt-6-luna
OPENAI_API_KEY=<APIキー>
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_REASONING_EFFORT=low
OPENAI_INITIAL_REASONING_EFFORT=low
```

設定後にAPIとワーカーを再起動し、`pnpm llm:probe` で基本モデルの疎通を確認してください。probeは予算に含める有料の生成を1回行い、モデル識別子・使用量・時間を保存します。接続確認はゲーム全体の品質検証とは別です。

各設定の `low` は通常行動と初期生成の両方に適用されます。モデル別の設定を共通の `LLM_REASONING_EFFORT` / `LLM_INITIAL_REASONING_EFFORT` より優先するため、既存のDeepSeek用highを残したまま切り替えられます。両方未指定時はDeepSeekがhigh、GeminiとGPT-6 Lunaがlowです。既存のDeepSeek設定も使え、`LLM_MODEL` がなければ `DEEPSEEK_MODEL`、それもなければ `deepseek-flash` を選びます。

Geminiは公式の[OpenAI互換endpoint](https://ai.google.dev/gemini-api/docs/openai)を使います。GPT-6 Lunaは[公式モデル仕様](https://developers.openai.com/api/docs/models/gpt-6-luna)に従いChat Completionsで接続し、`max_completion_tokens` と `service_tier=default` を指定します。Claudeは[Messages API](https://platform.claude.com/docs/en/api/messages/create)を使い、推論を有効にする場合はadaptive thinkingとeffortを指定します。選択するモデルがその形式・推論量に対応していることを確認してください。

### 上位モデルと確定判断

| 処理                                                | 使用する設定           |
| --------------------------------------------------- | ---------------------- |
| 初期生成、NPCの観測候補・意図形成、参加者の生成候補 | `LLM_MODEL`            |
| 相互作用・継続作用の結果提案（4）                   | `LLM_RESOLUTION_MODEL` |
| 共通Agentによる全候補の世界への確定判断             | `LLM_RESOLUTION_MODEL` |

確定担当は、提案と照会済みの根拠を読み、承認・修正要求・保留を返します。承認後も構造・依存版・実行世代を検証し、既存の原子的な確定とreceiptを使います。LLMが直接DBを書き換えることはありません。初期生成のT0確定は従来の生成処理です。

`LLM_RESOLUTION_JUDGMENT=combined` では、相互作用・継続作用の結果提案と意味的な確定判断を、上位モデルの同じ応答で行います。既定の `separate` は提案後に別の呼出しで確認します。Geminiなどが作る観測候補は引き続き上位モデルが別に確認し、本人の意図形成には各主体の観測・解釈だけを渡します。判断方式は操作の作成時に保存するため、設定を変えても既存操作の再開方法は変わりません。DeepSeekのdsh経路は従来のツールによる確定判断を使います。

同時点に起動する主体の観測は一括で確定し、意図は本人ごとに最大4並列で形成します。通常行動の同時点の応答処理では、新しい作用がない別主体のdeferredを元の行動文のまま保持し、結果担当へ繰り返し渡しません。本人への作用、新しいプレイヤー行動、世界内の時間経過では再評価し、世界構築の期間方針の評価は維持します。

上位モデルを切り替える例です。山括弧の値は、利用するモデルの仕様と料金に置き換えてください。Claudeの固定モデルIDや料金は組み込んでいません。

```dotenv
LLM_RESOLUTION_MODEL=<利用可能なClaudeのモデルID>
LLM_RESOLUTION_PROVIDER=anthropic
LLM_RESOLUTION_API=messages
LLM_RESOLUTION_REASONING_EFFORT=high
LLM_RESOLUTION_CONTEXT_TOKENS=<コンテキスト上限>
LLM_RESOLUTION_MAX_OUTPUT_TOKENS=<出力上限>
LLM_RESOLUTION_INPUT_USD_PER_MILLION=<入力の上限単価>
LLM_RESOLUTION_CACHED_INPUT_USD_PER_MILLION=<キャッシュ読取の上限単価>
LLM_RESOLUTION_OUTPUT_USD_PER_MILLION=<出力の上限単価>
ANTHROPIC_API_KEY=<APIキー>
ANTHROPIC_BASE_URL=https://api.anthropic.com/v1
```

既知の3モデル以外では、コンテキスト上限と3種類の単価が必須です。基本モデルへ使う場合は `LLM_RESOLUTION_` を `LLM_` に置き換えます。キャッシュ書込や長い入力の割増がある場合は、それを含む上限単価にしてください。`LLM_RESOLUTION_BASE_URL` で上位モデル専用の接続先も指定できます。`LLM_RESOLUTION_MODEL` が空欄なら従来の基本モデルを引き継ぐため、上位モデルで運用するには明示設定が必要です。

```powershell
pnpm llm:probe --target resolution
```

この確認は専用の小さな世界を作り、結果提案から世界への確定まで実行します。既存の試遊世界は変更しません。モデル・料金の変更は新しい呼出しへ適用し、保存済みの要求と応答は元の条件で再利用します。

同じ開始状態・行動によるGPT-6.1 Sol、Claude Sonnet 5.5、DeepSeek Flashの比較は、[上位モデルの実測記録](documents/evaluations/upper-models-2026-10-20.md)を参照してください。

### DeepSeek Harness

DeepSeekを結果担当に選んだ場合、結果提案と確定判断の両方を公式の[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）経由で実行します。上位設定を省略して基本モデルにDeepSeekを選んだ場合も同じです。独立したChat Completions呼出しへ置き換えません。

```dotenv
DEEPSEEK_API_KEY=<APIキー>
DEEPSEEK_HARNESS_BASE_URL=https://api.deepseek.com/anthropic
DEEPSEEK_HARNESS_HOME=artifacts/harness
```

```powershell
pnpm llm:harness-probe
```

このコマンドはプロセス内だけでDeepSeekを選び、同じ専用世界の確認をdsh経由で行います。`.env` の基本モデルは変更しません。dshに公開するツールは世界の照会・候補の提出・提出済み候補の確定・保留だけです。提出と確定は別のモデル判断にし、シェルやファイル編集のツールは公開しません。モデルへの送信前に共通予算を予約し、応答が不明な場合は自動再送せず予約を保持します。

Harnessが会話を再利用するため、署名や推論ブロックを含むnative応答は非公開の実行記録へ保存します。APIキーは保存せず、これらの内部記録を共有グラフ・プレイヤーの観測へ転記しません。ClaudeとOpenAIの直接呼出しでは、テキストと使用量だけを共通応答へ保存します。

## 初期生成

```powershell
pnpm llm:probe
pnpm world:generate --prompt examples/village.txt
pnpm world:generate --resume <runId>
```

初期入力はファイルから読み込み、エンジン内の固定設定にはしません。生成候補の構造・接続を検証し、Neo4jへの確定とPostgreSQLの構築記録・LangGraphチェックポイントを関連づけます。`ready` はT0の成立を表し、管理者による世界構築完了とは区別します。再取得だけでは生成や観測を再実行しません。構造検査の成功は意味的な整合性の証明ではありません。

`LLM_BUDGET_ID` が実測全体の費用を集計し、上限の既定値は40ドルです。`LLM_BUDGET_USD` で100ドルまで明示的に設定できます。保存済み予算は設定だけでは増額せず、利用者の承認に基づいて台帳の上限も変更する必要があります。増額しても使用済み額と応答未確定の予約は保持します。モデルを変えても同じIDを使い、DeepSeek・Gemini・OpenAI・Claudeの費用を通算します。既定IDは既存記録を引き継ぐため `deepseek-v4.1-flash-1017-evaluation` のままです。PostgreSQLで送信前の予約と応答後の精算を行い、再開・別プロセスでも共有します。

表示額は請求額ではなく、2026-10-19に公式資料で確認した料金から計算する上限見積です。DeepSeekは既存のピーク単価を維持します。Geminiは[公表済みの2027年以降の標準単価](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash)（100万トークンあたり入力1.50ドル・キャッシュ0.15ドル・出力7.50ドル）、GPT-6 Lunaは[長い入力とキャッシュ書込の割増](https://developers.openai.com/api/docs/models/gpt-6-luna)を含む上限単価（入力0.25ドル・出力0.75ドル）を使います。Geminiの2026年中の標準料金やGPTの通常の短い入力では、見積が請求より大きくなります。組み込み料金は上記の公式サービスのテキスト生成を対象とし、別料金の独自gatewayを使う場合はこの見積をそのまま請求額として扱わないでください。

応答喪失時は予約を残し、同じ呼出しIDを自動再送しません。上限や応答未確定による停止は実行上の保留であり、世界内の失敗ではありません。応答・使用量は共通の台帳へ保存します。新しい要求には接続条件と上限単価も保存し、設定変更後に同じ呼び出しを再開しても元の要求・精算条件を保持します。

1回の最大出力は接続確認で16,384トークン、初期生成で65,536トークンです。`LLM_MAX_OUTPUT_TOKENS` で設定でき、予約額にも反映します。APIキーは実測記録へ保存しません。サーバー側の入出力・使用量・遅延はPostgreSQL、生成の確認記録はローカルの `artifacts/evaluations/` に保存します。

実測結果は [初期生成の確認記録](documents/evaluations/deepseek-initial-world-2026-10-19.md) を参照してください。

通常行動の追加比較は [Sonnetの再測定とHaikuの観測・意図形成の検証記録](documents/evaluations/haiku-observation-2026-10-20.md) を参照してください。

API呼出しを減らした新フローと運用設定、2回の実測結果は [通常行動のフロー削減の記録](documents/evaluations/reduced-turn-flow-2026-10-20.md) を参照してください。

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

ブラウザーの通常プレイは、背景情報からあらすじを準備し、シーンを始めて自由記述で行動し、終了後にリザルトを読む流れです。`GET/POST /api/worlds/:id/scene`で準備・開始・行動・終了・再開を扱います。リザルトは世界への一括反映後に本人が知り得る記録から生成します。既存の通常行動APIと履歴も保持します。詳細は[ADR-008](documents/adr/ADR-008-scene-synopsis-results.md)を参照してください。

`/api/worlds/:id/events?role=admin` または `role=player` は、現在の権限を確認して更新通知を配信します。Last-Event-IDによる再送に対応し、別の主体・世界・ロールのcursorは拒否します。取得や再接続だけで世界内の観測は追加しません。CLIで作った世界へブラウザーの権限を自動付与しません。詳細は [ADR-004](documents/adr/ADR-004-world-api.md) を参照してください。

同時刻の意図と人間への操作返却は [ADR-005](documents/adr/ADR-005-human-play.md)、待ち時間と推論量の比較は [通常行動の実測](documents/evaluations/human-play-2026-10-19.md) を参照してください。`LLM_REASONING_EFFORT`で通常行動、`LLM_INITIAL_REASONING_EFFORT`で初期生成の推論量を指定できます。DeepSeekはnone・low・high・max、Geminiはlow・medium・high、GPT-6 Lunaはnone・low・medium・high・xhigh・maxを使えます。同じ呼出しIDの保存済み設定と応答は保持し、新しい呼出しから設定を適用します。

画面は [ADR-006](documents/adr/ADR-006-gameplay-ui.md) に従います。受付後の再読込で行動を追加送信せず、保存されたrunIdの入力と進行へ戻ります。履歴は前後へ取得でき、保持は4ページ、描画は表示範囲に絞ります。過去を読んでいる間の更新では位置を移動しません。通信の再接続時は、配信位置と公開状態を取得し直します。

`pnpm llm:compare --operation <operationId> --effort low` は上位モデル設定で完了済みの最終入力から候補を再生成し、構造と時間・使用量を記録します。差分を世界へ確定せず、同じ予算で通算します。dshによるツール実行が必要なDeepSeekはこの単独比較の対象外です。一つの候補の構造検査を、意味的な品質や通常プレイ全体の保証にはしません。

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
