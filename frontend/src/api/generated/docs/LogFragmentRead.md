# LogFragmentRead

ログフラグメント読み取りスキーマ

## Properties

| Name                  | Type                                          | Description      | Notes                             |
| --------------------- | --------------------------------------------- | ---------------- | --------------------------------- |
| **actionDescription** | **string**                                    | 行動の詳細な記述 | [default to undefined]            |
| **keywords**          | **Array&lt;string&gt;**                       | キーワード       | [optional] [default to undefined] |
| **emotionalValence**  | [**EmotionalValence**](EmotionalValence.md)   |                  | [optional] [default to undefined] |
| **rarity**            | [**LogFragmentRarity**](LogFragmentRarity.md) | レアリティ       | [optional] [default to undefined] |
| **importanceScore**   | **number**                                    | 重要度スコア     | [optional] [default to 0.0]       |
| **contextData**       | **object**                                    | 行動時の文脈情報 | [optional] [default to undefined] |
| **id**                | **string**                                    |                  | [default to undefined]            |
| **characterId**       | **string**                                    |                  | [default to undefined]            |
| **sessionId**         | **string**                                    |                  | [default to undefined]            |
| **createdAt**         | **string**                                    |                  | [default to undefined]            |

## Example

```typescript
import { LogFragmentRead } from './api'

const instance: LogFragmentRead = {
  actionDescription,
  keywords,
  emotionalValence,
  rarity,
  importanceScore,
  contextData,
  id,
  characterId,
  sessionId,
  createdAt,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
