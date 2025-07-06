# Cookie認証実装レポート

## 日付
2025-07-06

## 概要
LocalStorageに保存されていたauthTokenを、セキュアなCookie認証に移行しました。これにより、XSS攻撃に対する耐性が向上し、よりセキュアな認証システムが実現されました。

## 実装内容

### 1. バックエンド変更

#### Cookie設定の実装
- ログインエンドポイント（`/api/v1/auth/login`）でCookieを設定
- セキュリティ設定：
  - `httpOnly=True`: JavaScriptからアクセス不可（XSS対策）
  - `secure=True`: HTTPS通信のみ（本番環境）
  - `samesite="lax"`: CSRF対策
  - `max_age`: 8日間（既存のトークン有効期限と同じ）

#### 認証方式の拡張
- BearerトークンとCookieの両方から認証情報を取得可能
- 新しい`get_token`依存関数を実装
- 既存のAPIクライアントとの後方互換性を維持

#### ログアウト処理
- Cookieを適切に削除する処理を追加
- 開発環境と本番環境で異なるsecure設定を適用

### 2. フロントエンド変更

#### LocalStorage使用の削除
- `ApiClient`クラスからlocalStorage関連のコードを削除
- トークン管理ロジックを簡素化

#### Cookie送信設定
- 全てのAPI通信で`credentials: 'include'`を設定
- ログイン処理でもCookieを受信できるよう設定

#### AuthProviderの修正
- localStorage参照を削除
- Cookie認証を前提とした実装に変更
- 401エラーを正常な未認証状態として扱う

### 3. セキュリティ向上

#### 主な改善点
1. **XSS対策**: httpOnlyフラグによりJavaScriptからトークンにアクセス不可
2. **HTTPS強制**: 本番環境ではsecureフラグによりHTTPS通信のみ
3. **CSRF対策**: samesiteフラグにより、クロスサイトリクエストでのCookie送信を制限
4. **トークン露出防止**: ブラウザの開発者ツールでトークンが見えなくなった

## 技術的詳細

### Cookie設定（バックエンド）
```python
response.set_cookie(
    key="authToken",
    value=access_token,
    httponly=True,
    secure=settings.ENVIRONMENT != "development",
    samesite="lax",
    max_age=60 * 60 * 24 * 8,
    path="/"
)
```

### API通信設定（フロントエンド）
```typescript
fetch(url, {
    ...options,
    credentials: 'include',  // Cookieを自動送信
})
```

## 変更されたファイル

### バックエンド
- `/backend/app/api/api_v1/endpoints/auth.py`
  - Cookie設定・削除処理の追加
  - 認証取得の柔軟化

### フロントエンド
- `/frontend/src/api/client.ts`
  - localStorage使用の削除
  - credentials設定の追加
- `/frontend/src/features/auth/AuthProvider.tsx`
  - localStorage参照の削除

### ドキュメント
- `/documents/05_implementation/bestPractices.md`
  - Cookie認証のセキュリティベストプラクティスを追加

## 注意事項

### 開発時の考慮事項
- 開発環境では`secure=False`でHTTP通信でも動作
- CORSの`allow_credentials=True`が必要（既に設定済み）

### 移行時の注意
- 既存のBearerトークン認証も継続してサポート
- 段階的な移行が可能

## 今後の推奨事項

1. **リフレッシュトークンの実装**
   - 現在は8日間の固定期限
   - リフレッシュトークンによる自動更新を検討

2. **CSRF保護の強化**
   - CSRFトークンの実装を検討
   - 重要な操作での追加検証

3. **セッション管理の改善**
   - Redis等でのサーバーサイドセッション管理
   - トークン無効化機能の実装

## テスト結果
- 型チェック: ✅ 成功
- リント: ✅ 成功（warningのみ）
- 手動テスト: 未実施（推奨）

## まとめ
LocalStorageからセキュアなCookie認証への移行が完了しました。これにより、XSS攻撃に対する防御が大幅に向上し、よりセキュアな認証システムが実現されました。既存のAPIクライアントとの互換性も維持されているため、段階的な移行が可能です。