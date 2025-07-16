# PlayerSPRead

プレイヤーSP読み取り用スキーマ

## Properties

| Name                      | Type                                            | Description            | Notes                  |
| ------------------------- | ----------------------------------------------- | ---------------------- | ---------------------- |
| **currentSp**             | **number**                                      | 現在のSP残高           | [default to undefined] |
| **totalEarnedSp**         | **number**                                      | これまでに獲得した総SP | [default to undefined] |
| **totalConsumedSp**       | **number**                                      | これまでに消費した総SP | [default to undefined] |
| **id**                    | **string**                                      |                        | [default to undefined] |
| **userId**                | **string**                                      |                        | [default to undefined] |
| **totalPurchasedSp**      | **number**                                      |                        | [default to undefined] |
| **totalPurchaseAmount**   | **number**                                      |                        | [default to undefined] |
| **activeSubscription**    | [**SPSubscriptionType**](SPSubscriptionType.md) |                        | [default to undefined] |
| **subscriptionExpiresAt** | **string**                                      |                        | [default to undefined] |
| **consecutiveLoginDays**  | **number**                                      |                        | [default to undefined] |
| **lastLoginDate**         | **string**                                      |                        | [default to undefined] |
| **createdAt**             | **string**                                      |                        | [default to undefined] |
| **updatedAt**             | **string**                                      |                        | [default to undefined] |

## Example

```typescript
import { PlayerSPRead } from './api'

const instance: PlayerSPRead = {
  currentSp,
  totalEarnedSp,
  totalConsumedSp,
  id,
  userId,
  totalPurchasedSp,
  totalPurchaseAmount,
  activeSubscription,
  subscriptionExpiresAt,
  consecutiveLoginDays,
  lastLoginDate,
  createdAt,
  updatedAt,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
