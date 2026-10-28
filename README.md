# GESTALOKA v3

自前Oryの開発環境は[認証基盤の起動・検証手順](documents/operations-auth.md)を参照してください。

動的な自由記述シェアワールドを構築するプロジェクトです。
共通の世界更新Agent、時間指定の構築、別村民の生成、人間の自由記述行動を実装しています。Webから初期生成・試遊・追加進行・明示完了・別村民への参加を操作できます。村民の画面は、本人の観測・解釈と入力を表示します。

## 保存した物語の検品

`pnpm story:inspect`は、保存済みの提示情報からnシーンの移動量を取得し、JSONと可読報告を保存します。計測だけなら追加のLLM呼出しはありません。APIとワーカーを起動し、接続先を`GESTALOKA_API_URL`、管理者のログインCookieを`GESTALOKA_COOKIE`、またはMCP認可トークンを`GESTALOKA_MCP_TOKEN`へローカルで設定してください。MCPには利用する`inspection.*`のscopeと対象世界の許可が必要です。秘密値をコマンドや報告へ貼り付けないでください。

```powershell
pnpm story:inspect --world <worldId> --user <userId> --actor <actorId> --end <sceneId> --n 3
pnpm story:inspect --world <worldId> --manifest <manifestId>
pnpm story:inspect --world <worldId> --manifest <manifestId> --compare <otherManifestId>
pnpm story:inspect --world <worldId> --manifest <manifestId> --semantic --configuration <modelSettingsVersion> --target resolution --budget 1
```

既定の保存先は`artifacts/inspection`です。`--output <directory>`で変更できます。旧匿名記録では`--user`を省略します。意味評価の費用上限は生成費用と別で、設定したモデル版と共に記録します。既定では最大900秒待ち、未完了なら実行IDを含む部分評価を保存します。`--wait-seconds`で待機時間を指定できます。比較の右側は計測だけを取得し、意味評価がないことを比較条件に残します。移動量の低さでコマンドを失敗にしたり、世界を再生成したりしません。

管理画面の「物語の検品」では、対象資料、時系列、分布、欠測、費用と待ち時間、意味評価を確認できます。「定期検品の設定」を読み、対象世界、期間、n、頻度、サンプル数、モデル設定版と費用上限を指定して有効にします。費用上限は1回の対象抽出全体で共有します。設定前は無効で、既存pg-bossワーカーが有効な世界を1分ごとに確認します。プレイの応答は採点を待ちません。

規則は[ADR-017](documents/adr/ADR-017-narrative-inspection.md)、評価手順は[物語検品スキル](.agents/skills/narrative-inspection/SKILL.md)を参照してください。指標は未校正で、満足度の実測ではありません。旧記録の不足と未取得の続きは欠測として残します。

## ローカル起動

Node.js 22.23.4以上の22系または24.22.1以上の24系、pnpm 10.16.1、Linuxコンテナーを実行できるDocker Composeを使用します。

```powershell
pnpm install --frozen-lockfile
pnpm env:init
pnpm db:up
pnpm dev
```

Webは <http://127.0.0.1:5173> です。Viteが `/api` をAPIへ転送し、HTTPとSSEを同一オリジンで利用できます。API・Web・DBの公開ポートはループバックへ限定しています。`pnpm env:init` はランダムな開発用DB資格情報を `.env` に生成し、既存ファイルは上書きしません。手動設定する場合は `.env.example` を複製して空欄を埋めてください。資格情報の変更時は、永続化されたDBの資格情報も変更してください。

管理画面は <http://127.0.0.1:5174> の別アプリです。世界を操作するにはOryの起動と本人のログイン・利用登録も必要です。[認証・利用登録の手順](documents/operations-auth.md)を参照してください。

API・ワーカー・Web・管理画面は、それぞれ `pnpm --filter @gestaloka/api dev`、`pnpm --filter @gestaloka/worker dev`、`pnpm --filter @gestaloka/web dev`、`pnpm --filter @gestaloka/admin dev` でも起動できます。個別起動の前に `pnpm build:server` を実行してください。

`pnpm db:stop` はデータを残してDBを停止します。再起動は `pnpm db:up` です。Neo4j Community 5.26系とPostgreSQL 17をイメージのdigestで固定し、名前付きvolumeに永続化します。本番用のCompose・HTTPS・Ory認証・バックアップと復旧は[公開配置と復旧](documents/deployment.md)に実装済みの手順があります。サーバー契約・DNS公開・外部保管先の設定と、隔離環境での検証は区別します。

## 構成と公開契約

- `apps/api`: FastifyのHTTP/SSEと公開スキーマの登録。
- `apps/worker`: APIとは独立したNode.jsプロセス。pg-bossで構築ジョブを取得し、共通Agentで進行。
- `apps/web`: React / Vite。サーバー内部への依存をESLintで拒否。
- `apps/admin`: 管理者向けの別アプリ。共通の運用APIを利用。
- `packages/contracts`: ブラウザーでも利用できる公開Zodスキーマと生成HTTP型。
- `packages/server`: サーバー用のDB・キュー・チェックポイント接続。

`pnpm generate` は公開Zodスキーマを登録したFastifyからOpenAPIを取得し、openapi-typescriptでHTTPクライアント型を生成します。OpenAPIやクライアント型は直接編集しません。SSEのデータも公開Zodスキーマで実行時検証します。疎通用SSEは一つのメッセージで終了し、世界ごとの進捗SSEは保存済みIDからの再送に対応します。

## モデルの接続設定

推奨構成は、基本モデルがSonnet 5.5／low、上位モデルがSonnet 5.5／mediumです。両方ともAnthropic Messages APIを使い、確定判断は`combined`、最大出力は65,536トークンとします。[81条件のシーン比較](documents/evaluations/claude-scenes-2026-10-23.md)を根拠に採用しました。判断の詳細は[ADR-016](documents/adr/ADR-016-claude-model-selection.md)を参照してください。

初回設定には`.env.example`のLLM設定を使い、`ANTHROPIC_API_KEY`をローカルで設定してください。既存DBでは環境変数を変えるだけでは保存済み設定を上書きしないため、管理画面のモデル設定で両担当を更新します。新しい応答から新設定を使い、再開中の応答は取得済みの設定版を保持します。

`.env` の `LLM_MODEL` で基本モデルを、`LLM_RESOLUTION_MODEL` で結果提案・確定判断を担当する上位モデルを指定します。モデルIDは固定リストに制限しません。各サービスが返す利用可能なIDを指定してください。キーの値はチャットへ送らず、ローカルの `.env` に記入します。

| LLM_MODEL          | APIキー             | endpoint設定         | 既定のbase URL                                            |
| ------------------ | ------------------- | -------------------- | --------------------------------------------------------- |
| `deepseek-flash`   | `DEEPSEEK_API_KEY`  | `DEEPSEEK_BASE_URL`  | `https://api.deepseek.com`                                |
| `gemini-3.8-flash` | `GEMINI_API_KEY`    | `GEMINI_BASE_URL`    | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `gpt-6-luna`       | `OPENAI_API_KEY`    | `OPENAI_BASE_URL`    | `https://api.openai.com/v1`                               |
| ClaudeのモデルID   | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` | `https://api.anthropic.com/v1`                            |

endpointには `/chat/completions`・`/responses`・`/messages` を付けません。末尾の `/` はどちらでも使えます。ClaudeはAnthropic Messages API、OpenAIは既定でChat Completionsを使います。Responses APIを使うモデルには `OPENAI_API=responses` または対象側の `LLM_RESOLUTION_API=responses` を指定します。GPT-6.1 TerraとSolの既定のAPI形式はResponsesです。

OpenAIの新規応答では入力を事前計数し、30分・12時間キャッシュ作成の使用量と料金を分けて保存します。作成単価は `cacheWrite30mUsdPerMillion`・`cacheWrite12hUsdPerMillion` で上書きでき、省略時は通常入力の1.25倍・2.5倍です。272,000入力トークンを超えるTerra・Solの要求には、入力とキャッシュ2倍・出力1.5倍の単価を適用します。開始済み応答の料金版は子の処理にも引き継ぎ、既存の要求・応答の算定は変更しません。

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

| 処理                                      | 使用する設定           |
| ----------------------------------------- | ---------------------- |
| NPCの観測候補・意図形成、参加者の生成候補 | `LLM_MODEL`            |
| 初期生成と独立した確定前審査              | `LLM_RESOLUTION_MODEL` |
| 相互作用・継続作用の結果提案（4）         | `LLM_RESOLUTION_MODEL` |
| 共通Agentによる全候補の世界への確定判断   | `LLM_RESOLUTION_MODEL` |

確定担当は、提案と照会済みの根拠を読み、承認・修正要求・保留を返します。承認後も構造・依存版・実行世代を検証し、既存の原子的な確定とreceiptを使います。LLMが直接DBを書き換えることはありません。初期生成は上位モデルで候補を作り、別の呼出しで明示入力の充足・関係の意味・知識の分離を審査します。不合格なら修正へ戻し、承認された候補だけをT0へ確定します。

`LLM_RESOLUTION_JUDGMENT=combined` では、相互作用・継続作用の結果提案と意味的な確定判断を、上位モデルの同じ応答で行います。未指定時の `separate` は提案後に別の呼出しで確認します。Geminiなどが作る観測候補は引き続き上位モデルが別に確認し、本人の意図形成には各主体の観測・解釈だけを渡します。判断方式は操作の作成時に保存するため、設定を変えても既存操作の再開方法は変わりません。DeepSeekも同じ設定と確定判断の処理を使います。

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
pnpm llm:probe --target resolution --budget <USD>
```

この確認は専用の小さな世界を作り、結果提案から世界への確定まで実行します。既存の試遊世界は変更しません。モデル・料金の変更は新しい呼出しへ適用し、保存済みの要求と応答は元の条件で再利用します。

同じ開始状態・行動によるGPT-6.1 Sol、Claude Sonnet 5.5、DeepSeek Flashの比較は、[上位モデルの実測記録](documents/evaluations/upper-models-2026-10-20.md)を参照してください。

### DeepSeek API

DeepSeekもChat Completions APIで直接呼び出します。結果提案・確定判断・参加生成は、他プロバイダーと同じ共通処理で実行します。接続確認は`pnpm llm:probe --target resolution --budget <USD>`で行います。

## モデル利用枠

`LLM_MODEL_LIMITS`へ`provider:model`別のJSONを設定すると、同じAPIキーを使う複数ワーカーで利用枠を共有します。未設定のモデルには追加の枠待ちを設けません。全プロセスに同じ設定を渡してください。値は利用するAPI契約に合わせます。

```dotenv
LLM_MODEL_LIMITS={"gemini:YOUR_MODEL_ID":{"concurrency":2,"requestsPerMinute":30,"tokensPerMinute":200000}}
```

各項目は省略でき、設定した項目だけを制御します。並行数は送信から応答処理まで、要求数とトークン数は直近1分で数えます。トークン数は送信JSONのUTF-8バイト数と最大出力の合計を保守的に予約し、応答の使用量で精算します。プロバイダー固有のトークナイザーや課金集計窓の再現ではありません。1要求の予約が枠を超える設定は送信前に保留し、入力や出力を自動で切り詰めません。

枠待ち中はDBロックを保持せず、費用・操作回数もまだ予約しません。保存済み応答は枠待ちせず再利用します。通信結果が不明な要求はトークン予約を1分間保ち、プロセス停止で残った並行枠は4分で失効します。APIキーは枠の識別子としてハッシュ化し、原文を保存しません。費用予算と操作別通算上限は別に維持します。

## 初期生成

```powershell
pnpm llm:probe
pnpm world:generate --prompt examples/village.txt --budget <USD>
pnpm world:generate --resume <runId>
```

初期入力はファイルから読み込み、エンジン内の固定設定にはしません。生成候補の構造・接続と独立した意味的審査を経て、Neo4jへの確定とPostgreSQLの構築記録・LangGraphチェックポイントを関連づけます。`ready` はT0の成立を表し、管理者による世界構築完了とは区別します。再取得だけでは生成や観測を再実行しません。[詳しさの異なる入力の検証](documents/evaluations/initial-variants-2026-10-20.md)に、不足の検出・修正と確定後の照合を記録しています。

世界ごとの予算は作成時に明示し、初期生成から計算済み額と未確定予約額を通算します。`LLM_BUDGET_ID` / `LLM_BUDGET_USD` は、これとは別に明示した開発・検証用の全体費用枠です。#25以降の100ドルは既存の開発記録であり、実運用の世界や利用者の予算へ流用しません。未設定時に全体の金額上限は追加せず、予算IDの既定値は`service-usage`です。使用済み額と応答未確定の予約は保持し、モデルを変えても同じ枠で費用を通算します。世界予算の変更手順は[運用設定](documents/operations-auth.md#世界予算と応答生成のcall上限)を参照してください。

費用とは別に、応答生成1回のLLM call上限を管理者が設定でき、初期値は64回です。親子の呼出し・修正・再試行・再開を通算し、再開で枠を追加しません。構築は活動の節目ごとに通算し、グラフ照会の通算上限は設けません。上限では保存して保留し、管理者が上限を見直した後に再開します。[ADR-014](documents/adr/ADR-014-operating-limits.md)が[ADR-009の旧方式](documents/adr/ADR-009-execution-limits.md)を置き換えています。

表示額は使用量と保存済みの適用単価から求める計算額であり、請求額ではありません。推奨Claude構成の採用単価は[ADR-016](documents/adr/ADR-016-claude-model-selection.md)を参照してください。以下の組み込み3モデルの単価は、2026-10-19に公式資料で確認した上限見積用の値です。DeepSeekは既存のピーク単価を維持します。Geminiは[公表済みの2027年以降の標準単価](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash)（100万トークンあたり入力1.50ドル・キャッシュ0.15ドル・出力7.50ドル）、GPT-6 Lunaは[長い入力とキャッシュ書込の割増](https://developers.openai.com/api/docs/models/gpt-6-luna)を含む上限単価（入力0.25ドル・出力0.75ドル）を使います。Geminiの2026年中の標準料金やGPTの通常の短い入力では、見積が請求より大きくなります。組み込み料金は上記の公式サービスのテキスト生成を対象とし、別料金の独自gatewayを使う場合はこの見積をそのまま請求額として扱わないでください。

応答喪失時は予約を残し、同じ呼出しIDを自動再送しません。上限や応答未確定による停止は実行上の保留であり、世界内の失敗ではありません。応答・使用量は共通の台帳へ保存します。新しい要求には接続条件と上限単価も保存し、設定変更後に同じ呼び出しを再開しても元の要求・精算条件を保持します。

1回の最大出力はモデル設定で指定し、推奨構成では両担当とも65,536トークンです。初回の環境設定には`LLM_MAX_OUTPUT_TOKENS`等を使い、保存済み設定の運用変更は管理画面から行います。出力上限は予約額にも反映します。APIキーは実測記録へ保存しません。サーバー側の入出力・使用量・遅延はPostgreSQL、生成の確認記録はローカルの `artifacts/evaluations/` に保存します。

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
pnpm world:build create --prompt examples/village.txt --budget <USD>
pnpm world:build show --id <constructionId>
pnpm world:build advance --id <constructionId> --days 1
pnpm world:build show --id <constructionId>
pnpm world:build advance --id <constructionId> --days 1
pnpm world:build finish --id <constructionId>
pnpm world:build resume --id <constructionId>
```

`advance`はreadyの区切りから、`--days`で指定した日数を追加します。管理者の指定は最小1日、1日単位です。内部ではミリ秒で時点を保持し、1日未満の相互作用も処理します。構築中は各人物が本人の知識から期間の活動方針を形成し、日常や短いやり取りをまとめ、重要な変化で方針を見直します。追加期間では継続意図を保って新しい方針を形成します。詳細は [ADR-007](documents/adr/ADR-007-construction-activity-plans.md) を参照してください。

`finish`はその区切りで構築を完了します。参加は管理者が公開・受付を設定した後、ユーザー画面または共通APIの`worlds.join`からプリセットを選んで行います。CLIの`join`は廃止済みです。別の新しい村民を生成し、試遊村民の存在・履歴・所有・知識は残します。`resume`はpausedの処理を再開します。目標未到達の保留を、構築完了として扱いません。人間の自由記述行動は、期間方針による要約を適用せず、次の本人の判断場面まで進めます。

新規参加後の操作はユーザー画面で人物を選び、シーンから行います。既存の`participant_id`を持つ構築記録では、`pnpm world:build act --id <constructionId> --action examples/greet-neighbor.txt`も利用できます。この従来の通常行動は期間を指定せず、NPCの判断を必要に応じて挟み、次に人間の判断が必要になる場面まで進めます。人間の次の意図をAIで形成せず、継続中の活動と再開用の保存記録を保持します。

取得結果は到達時刻・目標時刻・主な処理記録・未処理の起動を含む管理情報です。区間をまたぐ継続と参加の契約は [ADR-003](documents/adr/ADR-003-construction-lifecycle.md)、実行結果と時間配分の残る問題は [構築の実測記録](documents/evaluations/construction-2026-10-19.md) を参照してください。

## 管理APIと公開知識

API・ワーカーとOryを起動し、ブラウザーからは同じオリジンのAPIを利用します。`GET/POST /api/session`はOryで認証したアプリIDを返し、利用登録・BANを確認します。匿名Cookieは本人確認後の既存データ引き継ぎに限って使います。変更操作には `X-Gestaloka-Request: 1` を付け、世界の作成・構築操作には再送用のrequestIdを指定します。

管理者は`/api/worlds`で予算を指定して世界を作成・取得し、`/api/worlds/:id/commands`で期間追加・再開・完了を行います。参加は`POST /api/operations`の`worlds.join`へ一本化しています。受付とpg-boss投入は同時保存され、202の後はワーカーで実行します。`/records` は管理者向けの報告、`/knowledge` は本人に対応する村民の観測・解釈だけを返します。履歴は1ページ50件で、nextから続きを取得できます。公開・参加・複数人物の選択は[ADR-013](documents/adr/ADR-013-world-participation.md)と[運用手順](documents/operations-auth.md#世界の公開と参加の共通api)を参照してください。

`/api/worlds/:id/actions` は自由記述のactionTextとrequestIdを受け付けます。操作対象はサーバー側の割当で決め、actorIdの自己申告は受け付けません。受付結果のrunIdから `/api/runs/:id` で本人の入力・到達時刻・処理状態を取得でき、`/api/worlds/:id/play/resume` で途中保留を再開できます。入力の受付と世界内の成功は区別します。

ブラウザーの通常プレイは、背景情報からあらすじを準備し、シーンを始めて自由記述で行動し、終了後にリザルトを読む流れです。`GET/POST /api/worlds/:id/scene`で準備・開始・行動・終了・再開を扱います。リザルトは世界への一括反映後に本人が知り得る記録から生成します。既存の通常行動APIと履歴も保持します。詳細は[ADR-008](documents/adr/ADR-008-scene-synopsis-results.md)を参照してください。

画面は`/scene?view=compact`で表示状態と直近の入力を取得し、`/scene/records?sceneId=<id>&kind=events`または`kind=actions`で本文・入力を前後50件ずつ取得します。全文の保存と既定の`/scene`応答は維持します。スクロール表示は最大4ページを保持して仮想描画し、ページの入替えでも読んでいる位置を保ちます。`/knowledge?excludeScene=<id>`は、同じシーン内で表示している受容の重複だけを除きます。

世界の確定時にNeo4jのreceiptへ未配信印を同時保存し、認可された更新通知へ反映してから配信済みにします。二つのDB間で停止した場合はreceiptから通知だけを回復します。他者の未観測情報を通知本文へ含めず、取得・配信だけで新しい観測も作りません。

`/api/worlds/:id/events?role=admin` または `role=player` は、現在の権限を確認して更新通知を配信します。Last-Event-IDによる再送に対応し、別の主体・世界・ロールのcursorは拒否します。取得や再接続だけで世界内の観測は追加しません。CLIで作った世界にも現在のサービス管理権限を適用し、CLI実行だけでは利用者へプレイヤーの操作対象を割り当てません。詳細は [ADR-004](documents/adr/ADR-004-world-api.md) を参照してください。

同時刻の意図と人間への操作返却は [ADR-005](documents/adr/ADR-005-human-play.md)、待ち時間と推論量の比較は [通常行動の実測](documents/evaluations/human-play-2026-10-19.md) を参照してください。`LLM_REASONING_EFFORT`で通常行動、`LLM_INITIAL_REASONING_EFFORT`で初期生成の推論量を指定できます。DeepSeekはnone・low・high・max、Geminiはlow・medium・high、GPT-6 Lunaはnone・low・medium・high・xhigh・maxを使えます。同じ呼出しIDの保存済み設定と応答は保持し、新しい呼出しから設定を適用します。

画面の履歴表示と再接続は[ADR-006](documents/adr/ADR-006-gameplay-ui.md)を引き継ぎ、シーン導線はADR-008、管理アプリの分離と参加導線はADR-013へ移行しています。受付後の再読込で行動を追加送信せず、保存された入力と進行へ戻ります。履歴は前後へ取得でき、保持は4ページ、描画は表示範囲に絞ります。過去を読んでいる間の更新では位置を移動しません。通信の再接続時は、配信位置と公開状態を取得し直します。

`pnpm llm:compare --operation <operationId> --effort low` は上位モデル設定で完了済みの最終入力から候補を再生成し、構造と時間・使用量を記録します。差分を世界へ確定せず、同じ予算で通算します。DeepSeekも通常APIを使う同じ比較の対象です。一つの候補の構造検査を、意味的な品質や通常プレイ全体の保証にはしません。

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

`pnpm test:poc`は、独立した更新・同一対象の競合・密な作用経路・キューの並行実行を実DBで計測します。外部LLMを呼ばず、専用データを作って終了時に削除します。出力先は任意の第1引数で指定でき、既定は`artifacts/evaluations/world-runtime-poc.json`です。[PoCの条件・結果・限界](documents/evaluations/world-runtime-poc-2026-10-20.md)を参照してください。

物語・行動結果の固定を検証の合格条件にしません。共有グラフの保存・確定・履歴と検証範囲は [ADR-001](documents/adr/ADR-001-world-graph.md) を参照してください。実モデルの品質・時間・費用と残る課題はdocuments/evaluationsに記録します。

## 設計資料

作業・設計の原則は [AGENTS.md](AGENTS.md)、視覚ルールは [DESIGN.md](DESIGN.md) にあります。実装対象は [#25](https://github.com/KingYoSun/gestaloka/issues/25) と関連Issueです。この開発基盤は [#29](https://github.com/KingYoSun/gestaloka/issues/29) の最初の実装単位です。

公開契約は [Fastify Zod provider](https://github.com/fastify/fastify-type-provider-zod)、疎通配信は [Fastify SSE](https://github.com/fastify/sse)、チェックポイントの再利用は [LangGraph Functional API](https://docs.langchain.com/oss/javascript/langgraph/functional-api) の仕様に従います。TypeScriptはtypescript-eslintとopenapi-typescriptの両方の対応範囲に合わせて5.9.3へ固定しています。
