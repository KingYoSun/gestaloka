# SPSubscriptionPurchaseResponse

サブスクリプション購入レスポンス

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**success** | **boolean** | 購入成功フラグ | [default to undefined]
**subscription_id** | **string** |  | [optional] [default to undefined]
**checkout_url** | **string** |  | [optional] [default to undefined]
**message** | **string** | メッセージ | [default to undefined]
**test_mode** | **boolean** | テストモードフラグ | [default to undefined]

## Example

```typescript
import { SPSubscriptionPurchaseResponse } from './api';

const instance: SPSubscriptionPurchaseResponse = {
    success,
    subscription_id,
    checkout_url,
    message,
    test_mode,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
