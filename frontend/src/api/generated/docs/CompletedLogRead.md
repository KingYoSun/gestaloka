# CompletedLogRead

完成ログ読み取りスキーマ

## Properties

| Name                   | Type                                            | Description    | Notes                             |
| ---------------------- | ----------------------------------------------- | -------------- | --------------------------------- |
| **name**               | **string**                                      | ログの名前     | [default to undefined]            |
| **title**              | **string**                                      |                | [optional] [default to undefined] |
| **description**        | **string**                                      | ログの説明文   | [default to undefined]            |
| **skills**             | **Array&lt;string&gt;**                         | 獲得したスキル | [optional] [default to undefined] |
| **personalityTraits**  | **Array&lt;string&gt;**                         | 性格特性       | [optional] [default to undefined] |
| **behaviorPatterns**   | **object**                                      | 行動パターン   | [optional] [default to undefined] |
| **id**                 | **string**                                      |                | [default to undefined]            |
| **creatorId**          | **string**                                      |                | [default to undefined]            |
| **coreFragmentId**     | **string**                                      |                | [default to undefined]            |
| **contaminationLevel** | **number**                                      |                | [default to undefined]            |
| **status**             | [**CompletedLogStatus**](CompletedLogStatus.md) |                | [default to undefined]            |
| **createdAt**          | **string**                                      |                | [default to undefined]            |
| **completedAt**        | **string**                                      |                | [default to undefined]            |

## Example

```typescript
import { CompletedLogRead } from './api'

const instance: CompletedLogRead = {
  name,
  title,
  description,
  skills,
  personalityTraits,
  behaviorPatterns,
  id,
  creatorId,
  coreFragmentId,
  contaminationLevel,
  status,
  createdAt,
  completedAt,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
