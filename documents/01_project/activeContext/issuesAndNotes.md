# 問題と注意事項 - ゲスタロカ (GESTALOKA)

このファイルには、既知の問題、開発上の注意事項、メモが記載されています。

## 最終更新: 2025-06-19

## 現在の課題

### パフォーマンス最適化
- **AI応答時間の短縮**: 現在約20秒 → 協調動作により改善見込み
- **グラフDBクエリ最適化**: 複雑なクエリの実行時間測定が必要

### Neo4j統合時の注意事項
- **ノードモデル定義**: neomodelを使用したオブジェクトマッピング
- **関係性の双方向性**: 関係作成時は必ず双方向を考慮
- **エラーハンドリング**: Neo4j接続エラー時の適切なフォールバック
- **トランザクション管理**: PostgreSQLとNeo4jのデータ整合性保持

### エラーハンドリング
- より詳細なエラーメッセージとリカバリー戦略の実装
- WebSocketエラー時の再接続処理の改善

## 技術的注意事項

### Alembicマイグレーション
- **重要**: SQLModelの自動テーブル作成により`--autogenerate`が機能しない場合がある
- 新しいモデル追加時の手順：
  1. `app/models/__init__.py`にインポートを追加
  2. `alembic/env.py`にもインポートを追加（必須！）
  3. マイグレーション作成: `docker-compose exec -T backend alembic revision --autogenerate -m "message"`
  4. 自動生成されない場合は手動作成が必要
- PostgreSQLのENUMタイプは`DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$`でラップする
- 履歴の手動更新: `INSERT INTO alembic_version (version_num) VALUES ('revision_id');`

### Gemini API設定
- **使用バージョン**: `gemini-2.5-pro`安定版（プレビュー版から移行済み）
- **temperature設定**: `model_kwargs`で設定（langchain-google-genai 2.1.5以降）
- **温度範囲**: 0.0-1.0に制限（langchainの制約）

### 依存関係管理
- `langchain-google-genai`に`google-generativeai`が含まれるため、重複インストールは避ける
- **バージョン固定**: 
  - `langchain==0.3.25`
  - `langchain-google-genai==2.1.5`
  - `langchain-community==0.3.18`

### Docker環境
- **TTY問題**: Makefileでのコマンド実行時は`-T`フラグが必要
- **ネットワーク設定**: 変更時は全コンテナの再作成が必要
- **ボリューム管理**: DBデータは永続化、ログは定期的にクリーンアップ

## 開発Tips

### ログNPC生成システム
```bash
# NPC生成タスクの監視
# Flowerダッシュボードでタスク実行状況を確認
http://localhost:5555

# 手動でNPC生成タスクを実行
docker-compose exec backend python -c "from app.tasks.log_tasks import generate_npc_from_completed_log; generate_npc_from_completed_log.delay('completed_log_id', '共通広場')"

# Neo4jでNPCエンティティを確認
MATCH (n:NPC) RETURN n LIMIT 10;
```

### 環境管理
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

### アクセスURL
- **フロントエンド**: http://localhost:3000
- **API ドキュメント**: http://localhost:8000/docs (Swagger UI)
- **KeyCloak管理**: http://localhost:8080/admin (admin/admin_password)
- **Neo4jブラウザ**: http://localhost:7474 (neo4j/gestaloka_neo4j_password)
- **Celery監視 (Flower)**: http://localhost:5555

### コード品質チェック
- **テスト**: `make test`
  - フロントエンド: 21件全て成功 ✅
  - バックエンド: 182件全て成功 ✅
- **型チェック**: `make typecheck`
  - フロントエンド: エラーなし ✅
  - バックエンド: 5件のエラー（型システムの制限）
- **リント**: `make lint`
  - フロントエンド: エラーなし ✅
  - バックエンド: エラーなし ✅
- **フォーマット**: `make format`

## 開発時の注意点

### 新規モデル追加時
1. `app/models/__init__.py`にインポートを追加
2. `alembic/env.py`にもインポートを追加（忘れやすい！）
3. マイグレーション作成と適用
4. テストの作成

### API変更時
1. OpenAPIスキーマの更新を確認
2. フロントエンドの型定義を再生成
3. APIクライアントのテスト更新
4. ドキュメントの更新

### テスト実行時
- Dockerコンテナが全て起動していることを確認
- 特にPostgreSQL、Neo4j、Redisが必要
- テスト用の環境変数が正しく設定されているか確認

## 残存する技術的問題（2025/06/19）

### バックエンドの型エラー（解決済み）
- **2025/06/19**: 全ての型エラーを解決 ✅
- **解決方法**: ターゲット指定の`# type: ignore`を適用
  - `logs.py` (401行目): `# type: ignore[arg-type]` - SQLModelのselect文の型推論制限
  - `logs.py` (404行目): `# type: ignore[assignment]` - Enum型の誤検知
  - `test_log_endpoints.py` (129, 195, 294行目): `# type: ignore[attr-defined]` - FastAPIアプリケーション属性
- **結果**: mypy実行時にエラー0件（Success: no issues found in 97 source files）

### バックエンドのテストエラー（解決済み）
- **2025/06/19**: 全182件のテストが成功 ✅
- **解決内容**:
  - `test_battle_integration.py`: SQLクエリの種類に応じて適切なモックオブジェクトを返すよう修正
  - `test_game_session_coordinator_integration.py`: 複数クエリの結果を順番に返すロジックを実装
  - モック設定の改善により、全ての統合テストが正常動作

### 対処方針
- 型エラー: ターゲット指定の`# type: ignore`で解決済み ✅
- テストエラー: 全て解決済み ✅
- 品質状態: 実装は完全に動作し、型チェック・テストも全てパス

## 既知の警告（機能に影響なし）

### TypeScript警告
- Viteの設定ファイルで`ConvertibleValue`型の警告
- React Contextの型定義で発生する場合がある

### pytest警告
- `asyncio_default_fixture_loop_scope`の設定警告（pytest-asyncio関連）
- 将来的に設定が必要だが、現在は無視して問題なし

## チーム間の調整事項

### フロントエンド⇔バックエンド
- API仕様の確定（OpenAPI準拠）
- WebSocketイベントの命名規則統一
- エラーコードの標準化

### AI⇔アプリケーション
- プロンプトテンプレートの管理方法
- AIレスポンスのスキーマ定義
- エラーハンドリング戦略

## セキュリティ注意事項
- **APIキー**: .envファイルで管理、本番環境では環境変数使用
- **SECRET_KEY**: 本番環境で必ず変更
- **CORS設定**: 本番環境では適切なオリジン制限
- **認証トークン**: JWTの有効期限とリフレッシュ戦略

## ハードコーディング箇所（更新 2025/06/19）
- **開発用として許容**: 認証情報、テストフィクスチャ、プロジェクト識別子
- **設定管理に移行済み**: 
  - キャラクター初期値（HP、エネルギー、攻撃力、防御力）
  - `app/core/config.py`で一元管理
- **将来的に設定管理**: URL、その他のゲームパラメータ

## コード品質改善（2025/06/19更新）

### DRY原則の適用
- **共通関数の作成**:
  - `app/utils/validation.py`: パスワードバリデーション
  - `app/utils/permissions.py`: 権限チェック
- **エラーハンドリングの統一**:
  - `app/core/error_handler.py`: グローバルエラーハンドラー
  - カスタム例外クラスの活用
- **NPCマネージャーの統合**: 重複実装を削除

### 型安全性の向上（2025/06/19更新）
- **フロントエンド**:
  - 全ての型エラーを解消 ✅
  - 全てのリントエラーを解消 ✅
  - 全てのテストが成功 (21件) ✅
- **バックエンド**:
  - リントエラーを完全解消 ✅
  - 型エラーを10個から5個に削減
    - `logs.py`の`desc()`使用方法を修正
    - `test_log_endpoints.py`の型エラーを修正
  - テストエラーを完全解消 (182件全て成功) ✅
    - `GameSessionService.execute_action()`の引数数を修正
    - 統合テストのモック設定を大幅改善
- **残存する問題**:
  - 型エラー5個: SQLModelとSQLAlchemyの型システムの制限による（機能に影響なし）

---

*このドキュメントは開発の進行に応じて頻繁に更新されます。*