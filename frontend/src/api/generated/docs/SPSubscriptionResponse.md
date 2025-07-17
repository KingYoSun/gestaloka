# SPSubscriptionResponse

サブスクリプションレスポンススキーマ

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**subscription_type** | [**SPSubscriptionType**](SPSubscriptionType.md) | サブスクリプションタイプ | [default to undefined]
**auto_renew** | **boolean** | 自動更新フラグ | [optional] [default to true]
**id** | **string** |  | [default to undefined]
**user_id** | **string** |  | [default to undefined]
**status** | [**SubscriptionStatus**](SubscriptionStatus.md) |  | [default to undefined]
**started_at** | **Date** |  | [default to undefined]
**expires_at** | **Date** |  | [default to undefined]
**cancelled_at** | **Date** |  | [default to undefined]
**stripe_subscription_id** | **string** |  | [default to undefined]
**stripe_customer_id** | **string** |  | [default to undefined]
**price** | **number** |  | [default to undefined]
**currency** | **string** |  | [default to undefined]
**next_billing_date** | **Date** |  | [default to undefined]
**trial_end** | **Date** |  | [default to undefined]
**created_at** | **Date** |  | [default to undefined]
**updated_at** | **Date** |  | [default to undefined]
**is_active** | **boolean** | 現在有効かどうか | [default to undefined]
**days_remaining** | **number** |  | [optional] [default to undefined]
**is_trial** | **boolean** | 試用期間中かどうか | [optional] [default to false]

## Example

```typescript
import { SPSubscriptionResponse } from './api';

const instance: SPSubscriptionResponse = {
    subscription_type,
    auto_renew,
    id,
    user_id,
    status,
    started_at,
    expires_at,
    cancelled_at,
    stripe_subscription_id,
    stripe_customer_id,
    price,
    currency,
    next_billing_date,
    trial_end,
    created_at,
    updated_at,
    is_active,
    days_remaining,
    is_trial,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
