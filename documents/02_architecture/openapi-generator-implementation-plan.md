# OpenAPI Generator導入計画書（破壊的移行版）

## 概要

GESTALOKA プロジェクトは開発段階のため、破壊的変更を前提とした迅速な移行を行います。本計画書は、OpenAPI Generatorを使用した型の完全自動生成システムへの即座の移行計画を示します。

## 移行方針

**破壊的移行の利点を最大限に活用**
- 既存の手動型定義をすべて削除
- 後方互換性を考慮しない
- 最短期間での完全移行

## 現状分析（簡潔版）

- **問題**: フロントエンドとバックエンドで型定義が重複
- **解決**: FastAPIの`/api/v1/openapi.json`から全型を自動生成
- **削除対象**: `frontend/src/types/`の大部分、`frontend/src/api/generated/`の手動定義

## 実装計画（3日間で完了）

### Day 1: セットアップと基本実装（1日目）

#### 午前: 環境構築
```bash
# 1. OpenAPI Generator CLIインストール
cd frontend
npm install --save-dev @openapitools/openapi-generator-cli

# 2. 初回生成テスト
npx @openapitools/openapi-generator-cli generate \
  -i http://localhost:8000/api/v1/openapi.json \
  -g typescript-axios \
  -o ./src/api/generated \
  --additional-properties=supportsES6=true,withSeparateModelsAndApi=true,modelPropertyNaming=camelCase
```

#### 午後: 設定ファイル作成と自動化
1. **openapi-generator-config.yml作成**
```yaml
generatorName: typescript-axios
outputDir: ./src/api/generated
inputSpec: http://backend:8000/api/v1/openapi.json
additionalProperties:
  supportsES6: true
  withSeparateModelsAndApi: true
  modelPropertyNaming: camelCase
  enumPropertyNaming: PascalCase
  useSingleRequestParameter: true
  withInterfaces: true
typeMappings:
  DateTime: Date
  date: Date
importMappings:
  Date: Date
```

2. **package.jsonスクリプト追加**
```json
{
  "scripts": {
    "generate:api": "openapi-generator-cli generate --config openapi-generator-config.yml",
    "generate:api:clean": "rm -rf ./src/api/generated && npm run generate:api",
    "dev": "concurrently \"npm run generate:api:watch\" \"vite\"",
    "generate:api:watch": "nodemon --watch 'http://localhost:8000/api/v1/openapi.json' --exec 'npm run generate:api'"
  }
}
```

3. **Makefile更新**
```makefile
generate-api: ## APIクライアントと型を生成
	docker-compose exec -T frontend npm run generate:api:clean
	
dev-with-types: ## 型自動生成付き開発サーバー
	make generate-api
	docker-compose up -d
```

### Day 2: 既存コードの破壊的置換（2日目）

#### 午前: 既存型定義の削除と置換
1. **削除対象ファイル**
   - `frontend/src/types/index.ts`の大部分
   - `frontend/src/api/generated/`の手動定義
   - 重複している型定義すべて

2. **インポート文の一括置換**
```bash
# VSCodeの検索置換で一括変更
# From: import { Character } from '@/types'
# To: import { Character } from '@/api/generated'
```

#### 午後: APIクライアントの統一
1. **api.tsの完全書き換え**
```typescript
// frontend/src/lib/api.ts
import { Configuration, DefaultApi } from '@/api/generated'

const config = new Configuration({
  basePath: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
  accessToken: () => localStorage.getItem('accessToken') || '',
})

export const api = new DefaultApi(config)

// 既存のaxiosインスタンスは削除
```

2. **全APIコールの置換**
```typescript
// Before
const response = await axios.get('/characters')

// After  
const response = await api.getCharacters()
```

### Day 3: 最適化と仕上げ（3日目）

#### 午前: 型の最適化
1. **不要な型の除外設定**
```yaml
# openapi-generator-config.ymlに追加
skipOperationExample: true
skipModelExample: true
modelPackage: models
apiPackage: api
```

2. **カスタムフックの作成**
```typescript
// frontend/src/hooks/useApi.ts
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

export const useCharacters = () => 
  useQuery({
    queryKey: ['characters'],
    queryFn: () => api.getCharacters()
  })
```

#### 午後: テストとドキュメント
1. **全テストの修正と実行**
```bash
make test-frontend
```

2. **CLAUDE.md更新**
```markdown
### API型の自動生成
すべてのAPI型は自動生成されます。手動で型を追加しないでください。

# 型を再生成
make generate-api

# 開発時は自動で型が更新される
make dev-with-types
```

## 破壊的移行のメリット

1. **即座の統一**
   - 3日で完全移行
   - 中途半端な状態を作らない

2. **シンプルな構成**
   - 自動生成のみに依存
   - 手動メンテナンス不要

3. **明確な責任分離**
   - バックエンド: 型の定義
   - フロントエンド: 型の使用のみ

## 移行後の開発フロー

```
1. バックエンドでPydanticモデルを変更
2. make generate-api を実行（または自動）
3. TypeScriptの型エラーを修正
4. 完了
```

## チェックリスト

### Day 1
- [ ] OpenAPI Generator CLIインストール
- [ ] 設定ファイル作成
- [ ] 初回生成テスト
- [ ] npm scripts追加
- [ ] Makefile更新

### Day 2  
- [ ] 既存型定義の削除
- [ ] import文の一括置換
- [ ] APIクライアントの置換
- [ ] 全コンポーネントの動作確認

### Day 3
- [ ] 型生成の最適化
- [ ] カスタムフック作成
- [ ] テスト修正
- [ ] ドキュメント更新
- [ ] 最終動作確認

## 注意事項

- **バックアップ不要**: Gitがあるので破壊的変更OK
- **段階的移行不要**: 開発段階なので一気に変更
- **下位互換性不要**: 他のシステムとの連携なし

## 成功基準

- 全ての型がOpenAPIから自動生成される
- 手動での型定義が0になる
- テストが全て通る
- 型チェックエラーが0になる