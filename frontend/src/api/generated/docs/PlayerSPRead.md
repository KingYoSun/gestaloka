# PlayerSPRead

プレイヤーSP読み取り用スキーマ

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**current_sp** | **number** | 現在のSP残高 | [default to undefined]
**total_earned_sp** | **number** | これまでに獲得した総SP | [default to undefined]
**total_consumed_sp** | **number** | これまでに消費した総SP | [default to undefined]
**id** | **string** |  | [default to undefined]
**user_id** | **string** |  | [default to undefined]
**total_purchased_sp** | **number** |  | [default to undefined]
**total_purchase_amount** | **number** |  | [default to undefined]
**active_subscription** | [**SPSubscriptionType**](SPSubscriptionType.md) |  | [default to undefined]
**subscription_expires_at** | **Date** |  | [default to undefined]
**consecutive_login_days** | **number** |  | [default to undefined]
**last_login_date** | **Date** |  | [default to undefined]
**created_at** | **Date** |  | [default to undefined]
**updated_at** | **Date** |  | [default to undefined]

## Example

```typescript
import { PlayerSPRead } from './api';

const instance: PlayerSPRead = {
    current_sp,
    total_earned_sp,
    total_consumed_sp,
    id,
    user_id,
    total_purchased_sp,
    total_purchase_amount,
    active_subscription,
    subscription_expires_at,
    consecutive_login_days,
    last_login_date,
    created_at,
    updated_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
