# PurchaseResponse

購入申請レスポンス

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**purchase_id** | **string** |  | [default to undefined]
**status** | [**PurchaseStatus**](PurchaseStatus.md) |  | [default to undefined]
**sp_amount** | **number** |  | [default to undefined]
**price_jpy** | **number** |  | [default to undefined]
**payment_mode** | [**PaymentMode**](PaymentMode.md) |  | [default to undefined]
**checkout_url** | **string** |  | [optional] [default to undefined]
**message** | **string** |  | [optional] [default to undefined]

## Example

```typescript
import { PurchaseResponse } from './api';

const instance: PurchaseResponse = {
    purchase_id,
    status,
    sp_amount,
    price_jpy,
    payment_mode,
    checkout_url,
    message,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
