# CompletedLogCreate

完成ログ作成スキーマ

## Properties

| Name                  | Type                    | Description                | Notes                             |
| --------------------- | ----------------------- | -------------------------- | --------------------------------- |
| **name**              | **string**              | ログの名前                 | [default to undefined]            |
| **title**             | **string**              |                            | [optional] [default to undefined] |
| **description**       | **string**              | ログの説明文               | [default to undefined]            |
| **skills**            | **Array&lt;string&gt;** | 獲得したスキル             | [optional] [default to undefined] |
| **personalityTraits** | **Array&lt;string&gt;** | 性格特性                   | [optional] [default to undefined] |
| **behaviorPatterns**  | **object**              | 行動パターン               | [optional] [default to undefined] |
| **creatorId**         | **string**              |                            | [default to undefined]            |
| **coreFragmentId**    | **string**              |                            | [default to undefined]            |
| **subFragmentIds**    | **Array&lt;string&gt;** | サブフラグメントのIDリスト | [optional] [default to undefined] |

## Example

```typescript
import { CompletedLogCreate } from './api'

const instance: CompletedLogCreate = {
  name,
  title,
  description,
  skills,
  personalityTraits,
  behaviorPatterns,
  creatorId,
  coreFragmentId,
  subFragmentIds,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
