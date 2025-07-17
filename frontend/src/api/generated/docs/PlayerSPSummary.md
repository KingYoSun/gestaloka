# PlayerSPSummary

プレイヤーSP概要スキーマ（軽量版）

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**current_sp** | **number** |  | [default to undefined]
**active_subscription** | [**SPSubscriptionType**](SPSubscriptionType.md) |  | [default to undefined]
**subscription_expires_at** | **Date** |  | [default to undefined]

## Example

```typescript
import { PlayerSPSummary } from './api';

const instance: PlayerSPSummary = {
    current_sp,
    active_subscription,
    subscription_expires_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
