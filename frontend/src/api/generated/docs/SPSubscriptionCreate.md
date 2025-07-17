# SPSubscriptionCreate

サブスクリプション作成スキーマ

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**subscription_type** | [**SPSubscriptionType**](SPSubscriptionType.md) | サブスクリプションタイプ | [default to undefined]
**auto_renew** | **boolean** | 自動更新フラグ | [optional] [default to true]
**payment_method_id** | **string** |  | [optional] [default to undefined]
**trial_days** | **number** |  | [optional] [default to undefined]

## Example

```typescript
import { SPSubscriptionCreate } from './api';

const instance: SPSubscriptionCreate = {
    subscription_type,
    auto_renew,
    payment_method_id,
    trial_days,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
