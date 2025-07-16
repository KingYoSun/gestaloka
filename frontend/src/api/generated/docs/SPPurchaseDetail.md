# SPPurchaseDetail

SP購入詳細

## Properties

| Name            | Type                                    | Description | Notes                             |
| --------------- | --------------------------------------- | ----------- | --------------------------------- |
| **id**          | **string**                              |             | [default to undefined]            |
| **planId**      | **string**                              |             | [default to undefined]            |
| **spAmount**    | **number**                              |             | [default to undefined]            |
| **priceJpy**    | **number**                              |             | [default to undefined]            |
| **status**      | [**PurchaseStatus**](PurchaseStatus.md) |             | [default to undefined]            |
| **paymentMode** | [**PaymentMode**](PaymentMode.md)       |             | [default to undefined]            |
| **testReason**  | **string**                              |             | [optional] [default to undefined] |
| **createdAt**   | **string**                              |             | [default to undefined]            |
| **updatedAt**   | **string**                              |             | [default to undefined]            |
| **approvedAt**  | **string**                              |             | [optional] [default to undefined] |

## Example

```typescript
import { SPPurchaseDetail } from './api'

const instance: SPPurchaseDetail = {
  id,
  planId,
  spAmount,
  priceJpy,
  status,
  paymentMode,
  testReason,
  createdAt,
  updatedAt,
  approvedAt,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
