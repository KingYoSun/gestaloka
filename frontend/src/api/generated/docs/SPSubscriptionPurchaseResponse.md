# SPSubscriptionPurchaseResponse

サブスクリプション購入レスポンス

## Properties

| Name               | Type        | Description        | Notes                             |
| ------------------ | ----------- | ------------------ | --------------------------------- |
| **success**        | **boolean** | 購入成功フラグ     | [default to undefined]            |
| **subscriptionId** | **string**  |                    | [optional] [default to undefined] |
| **checkoutUrl**    | **string**  |                    | [optional] [default to undefined] |
| **message**        | **string**  | メッセージ         | [default to undefined]            |
| **testMode**       | **boolean** | テストモードフラグ | [default to undefined]            |

## Example

```typescript
import { SPSubscriptionPurchaseResponse } from './api'

const instance: SPSubscriptionPurchaseResponse = {
  success,
  subscriptionId,
  checkoutUrl,
  message,
  testMode,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
