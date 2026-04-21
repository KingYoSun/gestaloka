# StripeCheckoutResponse

Stripeチェックアウトレスポンス

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**purchase_id** | **string** | 購入申請ID | [default to undefined]
**checkout_url** | **string** | StripeチェックアウトページへのリダイレクトURL | [default to undefined]
**session_id** | **string** | StripeチェックアウトセッションID | [default to undefined]

## Example

```typescript
import { StripeCheckoutResponse } from './api';

const instance: StripeCheckoutResponse = {
    purchase_id,
    checkout_url,
    session_id,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
