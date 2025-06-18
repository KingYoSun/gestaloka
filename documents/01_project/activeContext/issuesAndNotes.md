# 問題と注意事項 - ゲスタロカ (Gestaloka)

このファイルには、既知の問題、開発上の注意事項、メモが記載されています。

## 既知の問題

### 作業中に発見・解決した問題
- ✅ **重複ルートファイル問題**: `game.$sessionId.tsx`と`game/$sessionId.tsx`の競合 → 古いファイル削除で解決
- ✅ **未使用Navbarコンポーネント**: 古い`ui/layout/Navbar.tsx`が型エラー → ファイル削除とLayoutコンポーネント使用で解決
- ✅ **Radix UI依存関係不足**: `@radix-ui/react-scroll-area`不足 → シンプル版ScrollAreaコンポーネント作成で解決
- ✅ **型安全性エラー**: キャラクター選択での型推論エラー → 一時的なany型使用で解決（後で改善予定）
- ✅ **TanStack Router生成**: ルート競合によるコード生成失敗 → 重複ファイル削除後に正常生成
- ✅ **LangChain依存関係バージョン**: `langchain-google-genai==1.0.0`が存在しない → `0.0.11`に修正で解決
- ✅ **Docker ビルド失敗**: requirements.txtの依存関係問題 → パッケージバージョン修正で解決

### 現在の課題（2025/06/18更新）
- **コード品質警告**: リントの警告レベルの問題のみ残存
  - バックエンド: mypyのnoteレベルの通知のみ（エラー0件）
  - フロントエンド: ESLintの`any`型使用に関する警告37件（エラー0件）
- **パフォーマンス最適化**: AI応答時間の短縮（現在約20秒 → 協調動作により改善見込み）
- **エラーハンドリング**: より詳細なエラーメッセージとリカバリー戦略

### 解決済み
- ✅ APIクライアントの型変換（snake_case ↔ camelCase）実装済み
- ✅ Vite環境変数の型定義追加済み
- ✅ sonnerパッケージインストール済み
- ✅ ESLint設定エラー解決済み（`plugin:@typescript-eslint/recommended`に修正）
- ✅ ルーティングの型エラー解決済み（`/register`ルートを`routeTree.gen.ts`に追加）
- ✅ ゲームセッション型定義とAPIクライアント統合実装済み
- ✅ AI統合基盤の構築（GeminiClient、PromptManager、AIエージェント）
- ✅ プロンプトテンプレートシステムとLangChain統合
- ✅ 脚本家AI (Dramatist) の完全実装
- ✅ WebSocket実装完了（Socket.IO統合）
- ✅ 型エラー・リントエラー解消（mypy、ruff、ESLint、TypeScript）
- ✅ Pydantic v2対応（Field設定、validator更新）
- ✅ PostCSS設定修正（Tailwind CSS統合）
- ✅ バックエンド型チェックエラー修正（unreachableコードの修正）
- ✅ フロントエンド依存関係不足の解決（npm install実行）
- ✅ **Neo4j権限問題解決**: docker-compose.ymlでread-onlyマウント＋起動時コピー方式採用（2025/06/15）
- ✅ **Gemini API動作確認完了**: 脚本家AIの実動作テスト成功、高品質な物語生成を確認（2025/06/15）
- ✅ **AIレスポンス解析改善**: 選択肢の正確な抽出、タグ除去、最大3つの選択肢制限（2025/06/15）
- ✅ **GM AI評議会完全実装**: 全6メンバーの実装と包括的テスト完了（2025/06/16）
- ✅ **AI協調動作プロトコル実装**: CoordinatorAI、SharedContext、イベント連鎖システム完成（2025/06/16）
- ✅ **プロジェクト名統一**: TextMMO → GESTALOKA に変更、関連ファイル全て修正（2025/06/18）
- ✅ **Gemini 2.5 安定版移行**: プレビュー版から`gemini-2.5-pro`へ更新（2025/06/18）
- ✅ **依存関係更新**: LangChain 0.3.25、langchain-google-genai 2.1.5（2025/06/18）
- ✅ **Makefile TTY問題解決**: docker-compose execに-Tフラグ追加（2025/06/18）
- ✅ **全テストエラー解消**: バックエンド174件、フロントエンド21件全て成功（2025/06/18）
- ✅ **全型チェックエラー解消**: TypeScript、mypy共にエラー0件達成（2025/06/18）
- ✅ **全リントエラー解消**: ruff、ESLint共にエラー0件達成（2025/06/18）

## メモ・申し送り事項

### 開発Tips
- **環境起動**: `make setup-dev` で全自動セットアップ
- **KeyCloak管理**: http://localhost:8080/admin (admin/admin_password)
- **Neo4jブラウザ**: http://localhost:7474 (neo4j/gestaloka_neo4j_password)
- **API ドキュメント**: http://localhost:8000/docs (Swagger UI)
- **Celery監視**: http://localhost:5555 (Flower)
- **データベース初期化**: `make init-db`
- **ログ確認**: `make logs` または `make logs-backend`
- **環境変数**: ルートの`.env`ファイルで一元管理

### 開発コマンド
```bash
# 完全セットアップ
make setup-dev

# 個別サービス起動
make dev           # DB+KeyCloakのみ
make dev-full      # 全サービス

# メンテナンス
make clean         # 不要リソース削除
make db-reset      # DB完全リセット
make health        # ヘルスチェック
```

### 注意事項
- **APIキー**: .envファイルのGEMINI_API_KEY設定済み・動作確認完了
- **セキュリティ**: SECRET_KEYは本番環境で必ず変更
- **CORS**: フロントエンド・バックエンド連携設定済み
- **型安全性**: TypeScript + Pydantic で完全型チェック
- **コード品質チェック**: `make test`、`make typecheck`、`make lint`で確認可能
  - バックエンド: テスト✅（174件全て成功） 型チェック✅（エラー0件） Lint✅（エラー0件）
  - フロントエンド: テスト✅（21件全て成功） 型チェック✅（エラー0件） Lint✅（エラー0件、警告37件）
  - 注: 2025/06/18時点、全エラー解消完了
- **AI動作確認**: 全GM AI評議会メンバーテスト成功
- **Gemini API設定**: langchain-google-genai 2.1.5のtemperature設定方法変更対応済み
  - model_kwargsで設定、範囲は0.0-1.0のみサポート
- **ハードコーディング箇所**: 調査済み（2025/06/17）
  - 開発用として許容: 認証情報、テストフィクスチャ、プロジェクト識別子
  - 将来的に設定管理: URL、マジックナンバー、ゲームパラメータ

## チーム間の調整事項

### フロントエンド⇔バックエンド
- API仕様の確定（OpenAPI）
- WebSocketイベントの命名規則
- エラーコードの統一

### AI⇔アプリケーション
- プロンプトテンプレートの管理方法
- AIレスポンスのスキーマ定義
- エラーハンドリング戦略

## 技術的な実験・検証

### 実施予定
1. **LLMレスポンス時間測定**
   - 各種プロンプトでの応答速度
   - 並行リクエスト時の挙動

2. **グラフDBパフォーマンス**
   - 複雑なクエリの実行時間
   - インデックス戦略の検証

### 実験結果
- 未実施

---

*このドキュメントは開発の進行に応じて頻繁に更新されます。*