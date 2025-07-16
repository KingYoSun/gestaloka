# PurchaseResponse

購入申請レスポンス

## Properties

| Name            | Type                                    | Description | Notes                             |
| --------------- | --------------------------------------- | ----------- | --------------------------------- |
| **purchaseId**  | **string**                              |             | [default to undefined]            |
| **status**      | [**PurchaseStatus**](PurchaseStatus.md) |             | [default to undefined]            |
| **spAmount**    | **number**                              |             | [default to undefined]            |
| **priceJpy**    | **number**                              |             | [default to undefined]            |
| **paymentMode** | [**PaymentMode**](PaymentMode.md)       |             | [default to undefined]            |
| **checkoutUrl** | **string**                              |             | [optional] [default to undefined] |
| **message**     | **string**                              |             | [optional] [default to undefined] |

## Example

```typescript
import { PurchaseResponse } from './api'

const instance: PurchaseResponse = {
  purchaseId,
  status,
  spAmount,
  priceJpy,
  paymentMode,
  checkoutUrl,
  message,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
