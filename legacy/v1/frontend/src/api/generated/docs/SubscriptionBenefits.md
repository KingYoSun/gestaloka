# SubscriptionBenefits

サブスクリプション特典情報

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**subscription_type** | [**SPSubscriptionType**](SPSubscriptionType.md) |  | [default to undefined]
**name** | **string** |  | [default to undefined]
**price** | **number** |  | [default to undefined]
**daily_bonus** | **number** | 日次回復ボーナスSP | [default to undefined]
**discount_rate** | **number** | SP消費時の割引率 | [default to undefined]
**features** | **Array&lt;string&gt;** | その他の特典 | [default to undefined]

## Example

```typescript
import { SubscriptionBenefits } from './api';

const instance: SubscriptionBenefits = {
    subscription_type,
    name,
    price,
    daily_bonus,
    discount_rate,
    features,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
