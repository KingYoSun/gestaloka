# 問題と注意事項 - ゲスタロカ (GESTALOKA)

このファイルには、既知の問題、開発上の注意事項、メモが記載されています。

## 最終更新: 2025/07/01

### 2025/07/01の主な実装
- **SP購入システムのStripe統合** ✅
  - Stripe SDKのバックエンド統合完了
  - チェックアウトセッション作成API実装
  - Webhook受信・検証システム実装
  - フロントエンド決済フロー（テスト/本番モード対応）
  - 決済成功・キャンセルページの実装
  - セキュリティ対策（署名検証、環境変数管理）

### 2025/06/30の主な改善
- **コード品質の全面改善**: テスト・型・リントの完全クリーン化 ✅
  - バックエンド: テスト225/225成功、型エラー0、リントエラー0
  - フロントエンド: 全テスト成功、型エラー0、リントエラー0
  - ActionLogモデルの追加実装
  - インポートパスの統一とUser型定義の重複解消
- **バックエンド型エラーの完全解消**: 82個の型エラーを0に削減 ✅
  - AI統合関連ファイルの型定義修正
  - SQLModel/SQLAlchemy統合の改善
  - 非同期/同期処理の整合性確保
- **管理者用画面とAIパフォーマンス測定機能の実装** ✅
  - 管理者専用APIエンドポイント（/api/v1/admin/performance/）
  - ロールベースアクセス制御（RBAC）の実装
  - リアルタイムパフォーマンス監視ダッシュボード
  - パフォーマンステスト実行機能

## 現在の状態

### コード品質の完全クリーン化（2025/06/30）
- **バックエンド**: 
  - テスト: 225/225件成功 ✅✅✅✅
  - 型チェック: エラー0個 ✅（82個から削減）
  - リント: エラー0個 ✅
- **フロントエンド**: 
  - テスト: 21件全て成功 ✅
  - 型チェック: エラー0個 ✅
  - リント: エラー0個 ✅（警告のみ）

### 開発環境のヘルスチェック（完全正常）
- **全13サービスがhealthy状態** ✅（100%）
- 非同期タスク処理が完全に正常動作
- 開発環境が完全に安定

## 今後の技術的課題

### 中優先度
- **LogContractモデルの拡張**
  - `npc_id`フィールドの追加
  - 関連するビジネスロジックの実装
- **DispatchInteractionServiceの実装**
  - 派遣ログ間の相互作用サービス
  - 現在はTODOとしてマーク
- **管理者ロールチェック機能**
  - `/admin`ルートでのロール確認
  - Keycloakとの統合

### 低優先度
- **Pydantic V1→V2移行**
  - 現在21個の警告メッセージ
  - 機能には影響なし
- **TypeScriptのany型改善**
  - 現在20箇所で使用
  - 型安全性の向上のため

## 技術的注意事項

### Alembicマイグレーション
- **重要**: 新しいモデル追加時は必ず以下の手順を実行
  1. `app/models/__init__.py`にインポートを追加
  2. `alembic/env.py`にもインポートを追加（必須！）
  3. マイグレーション作成: `docker-compose exec -T backend alembic revision --autogenerate -m "message"`
  4. マイグレーション適用: `docker-compose exec -T backend alembic upgrade head`

### Gemini API設定
- **使用バージョン**: `gemini-2.5-pro`（安定版）
- **モデル切り替え**: `gemini-2.5-flash`（軽量版）も利用可能
- **temperature設定**: 0.0-1.0の範囲で設定

### Docker環境
- **TTY問題**: コマンド実行時は`-T`フラグが必要
- **テスト環境**: 専用のPostgreSQLとNeo4jコンテナを使用
- **ヘルスチェック**: 全サービスが正常動作中

### Stripe統合設定
- **環境変数**: `PAYMENT_MODE=production`で本番モード有効化
- **Webhook**: `/api/v1/stripe/webhook`で受信（認証不要）
- **価格ID**: Stripeダッシュボードで事前作成が必要
- **詳細**: `documents/05_implementation/stripe_integration_guide.md`参照

## 開発Tips

### コード品質チェック（全て成功）
```bash
# テスト
make test               # 全て成功
docker-compose exec -T backend sh -c "DOCKER_ENV=true pytest -v"
docker-compose exec frontend npm test

# 型チェック
make typecheck          # エラーなし
docker-compose exec backend mypy .
docker-compose exec frontend npm run typecheck

# リント
make lint               # エラーなし
docker-compose exec backend ruff check .
docker-compose exec frontend npm run lint

# フォーマット
make format
docker-compose exec backend ruff format .
```

### アクセスURL
- **フロントエンド**: http://localhost:3000
- **管理画面**: http://localhost:3000/admin
- **API ドキュメント**: http://localhost:8000/docs
- **KeyCloak管理**: http://localhost:8080/admin
- **Neo4jブラウザ**: http://localhost:7474
- **Celery監視 (Flower)**: http://localhost:5555

## 既知の警告（機能に影響なし）

### Pydantic V1スタイル警告
- 21個の`@validator`デコレータ警告
- 将来的に`@field_validator`への移行が推奨
- 現在は問題なく動作

### TypeScript any型警告
- 20箇所でany型を使用
- 主にWebSocketデータとエラーハンドリング
- 型安全性向上の余地あり

### bcrypt互換性警告
- `(trapped) error reading bcrypt version`
- bcryptを4.0.1に固定することで対応済み
- パスワードハッシュは正常動作

## セキュリティ注意事項
- **APIキー**: .envファイルで管理、本番環境では環境変数使用
- **SECRET_KEY**: 本番環境で必ず変更
- **CORS設定**: 本番環境では適切なオリジン制限
- **認証トークン**: JWTの有効期限とリフレッシュ戦略

---

*このドキュメントは開発の進行に応じて継続的に更新されます。*