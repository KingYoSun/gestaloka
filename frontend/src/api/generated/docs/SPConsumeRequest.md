# SPConsumeRequest

SP消費リクエストスキーマ

## Properties

| Name                  | Type                                          | Description      | Notes                             |
| --------------------- | --------------------------------------------- | ---------------- | --------------------------------- |
| **amount**            | **number**                                    | 消費するSP量     | [default to undefined]            |
| **transactionType**   | [**SPTransactionType**](SPTransactionType.md) | 取引の種類       | [default to undefined]            |
| **description**       | **string**                                    | 取引の説明       | [default to undefined]            |
| **relatedEntityType** | **string**                                    |                  | [optional] [default to undefined] |
| **relatedEntityId**   | **string**                                    |                  | [optional] [default to undefined] |
| **metadata**          | **object**                                    | 追加のメタデータ | [optional] [default to undefined] |

## Example

```typescript
import { SPConsumeRequest } from './api'

const instance: SPConsumeRequest = {
  amount,
  transactionType,
  description,
  relatedEntityType,
  relatedEntityId,
  metadata,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
