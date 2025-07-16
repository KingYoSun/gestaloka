# CompletedLogUpdate

完成ログ更新スキーマ

## Properties

| Name                  | Type                                            | Description | Notes                             |
| --------------------- | ----------------------------------------------- | ----------- | --------------------------------- |
| **name**              | **string**                                      |             | [optional] [default to undefined] |
| **title**             | **string**                                      |             | [optional] [default to undefined] |
| **description**       | **string**                                      |             | [optional] [default to undefined] |
| **skills**            | **Array&lt;string&gt;**                         |             | [optional] [default to undefined] |
| **personalityTraits** | **Array&lt;string&gt;**                         |             | [optional] [default to undefined] |
| **behaviorPatterns**  | **object**                                      |             | [optional] [default to undefined] |
| **status**            | [**CompletedLogStatus**](CompletedLogStatus.md) |             | [optional] [default to undefined] |

## Example

```typescript
import { CompletedLogUpdate } from './api'

const instance: CompletedLogUpdate = {
  name,
  title,
  description,
  skills,
  personalityTraits,
  behaviorPatterns,
  status,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
