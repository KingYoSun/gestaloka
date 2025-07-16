# PlayerSPSummary

プレイヤーSP概要スキーマ（軽量版）

## Properties

| Name                      | Type                                            | Description | Notes                  |
| ------------------------- | ----------------------------------------------- | ----------- | ---------------------- |
| **currentSp**             | **number**                                      |             | [default to undefined] |
| **activeSubscription**    | [**SPSubscriptionType**](SPSubscriptionType.md) |             | [default to undefined] |
| **subscriptionExpiresAt** | **string**                                      |             | [default to undefined] |

## Example

```typescript
import { PlayerSPSummary } from './api'

const instance: PlayerSPSummary = {
  currentSp,
  activeSubscription,
  subscriptionExpiresAt,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
