# OpenAPI Generator移行ガイド

## 概要

本ドキュメントは、GESTALOKAプロジェクトでOpenAPI Generatorを使用した型の自動生成システムへの移行方法を説明します。

## 移行状況（2025-07-16現在）

### 完了済み
- ✅ OpenAPI Generator環境構築
- ✅ 型の自動生成設定
- ✅ 基本的なAPIクライアント設定
- ✅ 一部のhooksの移行（useCharacters.ts、useSP.ts）

### 未完了
- ❌ 全てのhooksとコンポーネントの移行
- ❌ 型エラーの完全な解決
- ❌ テストの更新

## 基本的な使い方

### 1. 型の生成/更新

バックエンドのAPIが変更された場合、以下のコマンドで型を再生成します：

```bash
# Makefileを使用
make generate-api

# またはnpmコマンド
docker-compose exec -T frontend npm run generate:api:clean
```

### 2. APIクライアントの使用

```typescript
// 旧: apiClientを使用
import { apiClient } from '@/api/client'
const characters = await apiClient.getCharacters()

// 新: 個別のAPIクライアントを使用
import { charactersApi } from '@/lib/api'
const characters = await charactersApi.getUserCharactersApiV1CharactersGet()
```

### 3. 型のインポート

```typescript
// 旧: @/typesから手動定義の型をインポート
import { Character, User } from '@/types'

// 新: @/api/generatedから自動生成された型をインポート
import { Character, User } from '@/api/generated'
```

## プロパティ名の違い

バックエンドはsnake_case、フロントエンドはcamelCaseを使用したい場合があります。

### 自動生成された型（snake_case）
```typescript
interface Character {
  user_id: string
  is_active: boolean
  created_at: string
}
```

### 変換が必要な場合
```typescript
import { toFrontendCharacter } from '@/lib/type-adapters'

// APIレスポンスを変換
const apiCharacter = await charactersApi.getCharacterApiV1CharactersCharacterIdGet({ characterId })
const frontendCharacter = toFrontendCharacter(apiCharacter)
```

## 移行時の注意点

### 1. メソッド名の変更

OpenAPI Generatorで生成されるメソッド名は長く、規則的です：

- `getCharacters` → `getUserCharactersApiV1CharactersGet`
- `createCharacter` → `createCharacterApiV1CharactersPost`
- `updateCharacter` → `updateCharacterApiV1CharactersCharacterIdPut`

### 2. パラメータの渡し方

多くのメソッドはオブジェクトでパラメータを受け取ります：

```typescript
// 旧
await apiClient.getCharacter(characterId)

// 新
await charactersApi.getCharacterApiV1CharactersCharacterIdGet({ 
  characterId: characterId 
})
```

### 3. セッション関連の型

セッション機能は再作成予定のため、一時的に`/types/session-temp.ts`に保管されています。これらの型は後で自動生成に移行されます。

## トラブルシューティング

### 型エラーが発生する場合

1. 型を再生成する
```bash
make generate-api
```

2. TypeScriptの型チェックを実行
```bash
make typecheck
```

3. 必要に応じて`/lib/type-adapters.ts`で変換関数を追加

### APIメソッドが見つからない場合

生成されたAPIファイルで正しいメソッド名を確認：
```bash
# メソッド名を検索
grep -r "methodName" frontend/src/api/generated/api/
```

## 今後の作業

1. 残りのhooksとコンポーネントの移行
2. 型エラーの解決
3. テストの更新
4. セッション関連APIの再実装時に型を自動生成に移行