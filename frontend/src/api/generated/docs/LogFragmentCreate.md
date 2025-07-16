# LogFragmentCreate

ログフラグメント作成スキーマ

## Properties

| Name                  | Type                                          | Description      | Notes                             |
| --------------------- | --------------------------------------------- | ---------------- | --------------------------------- |
| **actionDescription** | **string**                                    | 行動の詳細な記述 | [default to undefined]            |
| **keywords**          | **Array&lt;string&gt;**                       | キーワード       | [optional] [default to undefined] |
| **emotionalValence**  | [**EmotionalValence**](EmotionalValence.md)   | 感情価           | [optional] [default to undefined] |
| **rarity**            | [**LogFragmentRarity**](LogFragmentRarity.md) | レアリティ       | [optional] [default to undefined] |
| **importanceScore**   | **number**                                    | 重要度スコア     | [optional] [default to 0.0]       |
| **contextData**       | **object**                                    | 行動時の文脈情報 | [optional] [default to undefined] |
| **characterId**       | **string**                                    |                  | [default to undefined]            |
| **sessionId**         | **string**                                    |                  | [default to undefined]            |

## Example

```typescript
import { LogFragmentCreate } from './api'

const instance: LogFragmentCreate = {
  actionDescription,
  keywords,
  emotionalValence,
  rarity,
  importanceScore,
  contextData,
  characterId,
  sessionId,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
