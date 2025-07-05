# CORSエラーの根本解決 - 進捗レポート

## 実施日時: 2025-07-05 18:35 JST

## 概要
フロントエンドからバックエンドAPIへのリクエスト時に発生していたCORSエラーを根本的に解決しました。

## 問題の詳細

### エラー内容
```
Access to fetch at 'http://localhost:8000/api/v1/auth/register' from origin 'http://localhost:3000' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

### 原因分析
1. **Pydantic AnyHttpUrl型の挙動**
   - `settings.BACKEND_CORS_ORIGINS`で定義されたURLが自動的に末尾スラッシュを追加
   - 例: `http://localhost:3000` → `http://localhost:3000/`

2. **CORSミドルウェアのマッチング失敗**
   - ブラウザからのOriginヘッダー: `http://localhost:3000`（スラッシュなし）
   - 設定されたオリジン: `http://localhost:3000/`（スラッシュあり）
   - 正確なマッチングが必要なため、プリフライトリクエストが400エラーを返す

## 解決方法

### 1. CORSミドルウェア設定の修正
`backend/app/main.py`で末尾スラッシュを削除する処理を追加：

```python
# CORS設定 - 最後に追加（FastAPIのミドルウェアは逆順実行のため）
# AnyHttpUrlの末尾スラッシュを削除して文字列に変換
cors_origins = [str(origin).rstrip("/") for origin in settings.BACKEND_CORS_ORIGINS]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)
```

### 2. ミドルウェアの実行順序
- FastAPIのミドルウェアは追加された順の逆順で実行される
- CORSミドルウェアを最後に追加することで、最初に実行されるように配置

## 技術的な利点

1. **環境変数による動的設定の維持**
   - ハードコードされたオリジンリストではなく、環境変数から読み込み
   - 本番環境での柔軟な設定変更が可能

2. **後方互換性の確保**
   - 既存の環境変数設定を変更する必要なし
   - `.env`ファイルの`BACKEND_CORS_ORIGINS`はそのまま使用可能

## 検証結果

### CORSプリフライトリクエストのテスト
```bash
curl -I -X OPTIONS http://localhost:8000/api/v1/auth/register \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

**修正前**: 400 Bad Request（Access-Control-Allow-Originヘッダーなし）
**修正後**: 200 OK（正しいCORSヘッダー付き）

### 最終確認
- フロントエンドからの会員登録: ✅ 成功
- フロントエンドからのログイン: ✅ 成功
- APIリクエスト全般: ✅ 正常動作

## まとめ
Pydantic AnyHttpUrl型の挙動を理解し、適切な文字列処理を追加することで、環境変数による動的CORS設定を維持しながら問題を解決しました。この修正により、開発環境でも本番環境でも柔軟なCORS設定が可能となりました。