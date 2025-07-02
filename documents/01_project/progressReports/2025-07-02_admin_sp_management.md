# 管理画面でのSP付与・調整機能の実装

## 日付: 2025-07-02

## 概要
管理者がプレイヤーのSP（ストーリーポイント）を手動で調整できる機能を実装しました。これにより、イベント配布、バグ補填、テストなどの用途でSPを付与・減算できるようになります。

## 実装内容

### バックエンド

1. **管理者用APIエンドポイント** (`/api/v1/admin/sp/`)
   - `GET /players` - 全プレイヤーのSP情報一覧（検索機能付き）
   - `GET /players/{user_id}` - 特定プレイヤーのSP詳細
   - `GET /players/{user_id}/transactions` - SP取引履歴
   - `POST /adjust` - 個別SP調整
   - `POST /batch-adjust` - 一括SP調整

2. **新しいSP取引タイプの追加**
   - `ADMIN_GRANT` - 管理者付与
   - `ADMIN_DEDUCT` - 管理者減算

3. **権限チェック**
   - `get_current_admin_user` デペンデンシーによる管理者権限確認

### フロントエンド

1. **SP管理画面** (`/admin/sp`)
   - プレイヤー一覧表示（現在SP、総獲得、総消費、連続ログイン日数など）
   - 検索機能（ユーザー名、メールアドレス）
   - SP調整ダイアログ（金額入力、理由記載）
   - 取引履歴表示ダイアログ

2. **管理画面レイアウトの更新**
   - サイドバーにSP管理へのリンク追加

## 技術的な詳細

- 非同期処理に対応（async/await）
- 型安全性を保証（TypeScript）
- エラーハンドリング実装
- トランザクション履歴の完全な記録

## 今後の改善点

1. **バッチ処理UI**
   - 現在APIは実装済みだが、UIは個別調整のみ
   - CSVインポートなどの一括処理UI追加を検討

2. **フィルタリング機能**
   - SP残高でのフィルタリング
   - 最終ログイン日でのソート

3. **統計情報**
   - 管理画面ダッシュボードでのSP統計表示

## 関連ファイル

- `backend/app/api/v1/admin/sp_management.py`
- `backend/app/schemas/admin/sp_management.py`
- `frontend/src/api/admin/spManagement.ts`
- `frontend/src/features/admin/SPManagement.tsx`
- `frontend/src/routes/admin/sp.tsx`