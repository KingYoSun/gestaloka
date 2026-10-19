# GESTALOKA v3

動的な自由記述シェアワールドを構築するプロジェクトです。
現在は開発基盤を実装しています。APIは疎通確認用HTTP/SSE、ワーカーはキューとチェックポイントの初期化、Webは起動画面までです。世界生成・試遊・通常プレイは未実装です。

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
- `apps/worker`: APIとは独立したNode.jsプロセス。pg-bossとLangGraphのPostgreSQLチェックポイントを初期化。
- `apps/web`: React / Vite。サーバー内部への依存をESLintで拒否。
- `packages/contracts`: ブラウザーでも利用できる公開Zodスキーマと生成HTTP型。
- `packages/server`: サーバー用のDB・キュー・チェックポイント接続。

`pnpm generate` は公開Zodスキーマを登録したFastifyからOpenAPIを取得し、openapi-typescriptでHTTPクライアント型を生成します。OpenAPIやクライアント型は直接編集しません。SSEのデータも公開Zodスキーマで実行時検証します。現在の疎通用SSEは一つのメッセージで終了し、世界更新の再送契約はまだ含みません。

## 検証

```powershell
pnpm check
pnpm db:up
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm check` は生成物の整合性、tscの型検査、lint、整形、単体・コンポーネントテスト、ビルドを実行します。Viteビルドとは別に型検査します。生成物の変更後は `pnpm generate` を実行してください。

統合テストは実DBを使い、Neo4jの再接続後の読取、PostgreSQLトランザクション内のキュー投入のロールバック、LangGraphの中断・再開と保存済みtaskの再利用を確認します。テストは専用レコードとキューを作り、世界モデルの正本を作りません。ブラウザーテストは実APIへ接続し、HTTPと標準EventSourceの疎通を確認します。

物語・行動結果の固定を検証の合格条件にしません。Neo4jの世界確定・並行更新、実モデルによる意味評価、世界構築から村民への引継ぎは、後続実装でそれぞれ検証します。

## 設計資料

作業・設計の原則は [AGENTS.md](AGENTS.md)、視覚ルールは [DESIGN.md](DESIGN.md) にあります。実装対象は [#25](https://github.com/KingYoSun/gestaloka/issues/25) と関連Issueです。この開発基盤は [#29](https://github.com/KingYoSun/gestaloka/issues/29) の最初の実装単位です。

公開契約は [Fastify Zod provider](https://github.com/fastify/fastify-type-provider-zod)、疎通配信は [Fastify SSE](https://github.com/fastify/sse)、チェックポイントの再利用は [LangGraph Functional API](https://docs.langchain.com/oss/javascript/langgraph/functional-api) の仕様に従います。TypeScriptはtypescript-eslintとopenapi-typescriptの両方の対応範囲に合わせて5.9.3へ固定しています。
