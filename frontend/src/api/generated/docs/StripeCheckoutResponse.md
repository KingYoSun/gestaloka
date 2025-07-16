# StripeCheckoutResponse

Stripeチェックアウトレスポンス

## Properties

| Name            | Type       | Description                                   | Notes                  |
| --------------- | ---------- | --------------------------------------------- | ---------------------- |
| **purchaseId**  | **string** | 購入申請ID                                    | [default to undefined] |
| **checkoutUrl** | **string** | StripeチェックアウトページへのリダイレクトURL | [default to undefined] |
| **sessionId**   | **string** | StripeチェックアウトセッションID              | [default to undefined] |

## Example

```typescript
import { StripeCheckoutResponse } from './api'

const instance: StripeCheckoutResponse = {
  purchaseId,
  checkoutUrl,
  sessionId,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
