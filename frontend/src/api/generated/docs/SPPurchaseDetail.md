# SPPurchaseDetail

SP購入詳細

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **string** |  | [default to undefined]
**plan_id** | **string** |  | [default to undefined]
**sp_amount** | **number** |  | [default to undefined]
**price_jpy** | **number** |  | [default to undefined]
**status** | [**PurchaseStatus**](PurchaseStatus.md) |  | [default to undefined]
**payment_mode** | [**PaymentMode**](PaymentMode.md) |  | [default to undefined]
**test_reason** | **string** |  | [optional] [default to undefined]
**created_at** | **Date** |  | [default to undefined]
**updated_at** | **Date** |  | [default to undefined]
**approved_at** | **Date** |  | [optional] [default to undefined]

## Example

```typescript
import { SPPurchaseDetail } from './api';

const instance: SPPurchaseDetail = {
    id,
    plan_id,
    sp_amount,
    price_jpy,
    status,
    payment_mode,
    test_reason,
    created_at,
    updated_at,
    approved_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
