# LogFragmentDetail

ログフラグメントの詳細スキーマ

## Properties

| Name                  | Type                                          | Description                  | Notes                             |
| --------------------- | --------------------------------------------- | ---------------------------- | --------------------------------- |
| **keyword**           | **string**                                    | メインキーワード             | [default to undefined]            |
| **keywords**          | **Array&lt;string&gt;**                       | 関連キーワードリスト         | [default to undefined]            |
| **emotionalValence**  | [**EmotionalValence**](EmotionalValence.md)   |                              | [default to undefined]            |
| **rarity**            | [**LogFragmentRarity**](LogFragmentRarity.md) | レアリティ                   | [default to undefined]            |
| **backstory**         | **string**                                    | フラグメントの背景ストーリー | [default to undefined]            |
| **id**                | **string**                                    |                              | [default to undefined]            |
| **characterId**       | **string**                                    |                              | [default to undefined]            |
| **actionDescription** | **string**                                    | 行動の詳細な記述             | [default to undefined]            |
| **discoveredAt**      | **string**                                    |                              | [optional] [default to undefined] |
| **sourceAction**      | **string**                                    |                              | [optional] [default to undefined] |
| **importanceScore**   | **number**                                    | 重要度スコア（0.0-1.0）      | [default to undefined]            |
| **contextData**       | **object**                                    | 文脈情報                     | [default to undefined]            |
| **createdAt**         | **string**                                    |                              | [default to undefined]            |

## Example

```typescript
import { LogFragmentDetail } from './api'

const instance: LogFragmentDetail = {
  keyword,
  keywords,
  emotionalValence,
  rarity,
  backstory,
  id,
  characterId,
  actionDescription,
  discoveredAt,
  sourceAction,
  importanceScore,
  contextData,
  createdAt,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
