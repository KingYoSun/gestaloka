# SubscriptionBenefits

サブスクリプション特典情報

## Properties

| Name                 | Type                                            | Description        | Notes                  |
| -------------------- | ----------------------------------------------- | ------------------ | ---------------------- |
| **subscriptionType** | [**SPSubscriptionType**](SPSubscriptionType.md) |                    | [default to undefined] |
| **name**             | **string**                                      |                    | [default to undefined] |
| **price**            | **number**                                      |                    | [default to undefined] |
| **dailyBonus**       | **number**                                      | 日次回復ボーナスSP | [default to undefined] |
| **discountRate**     | **number**                                      | SP消費時の割引率   | [default to undefined] |
| **features**         | **Array&lt;string&gt;**                         | その他の特典       | [default to undefined] |

## Example

```typescript
import { SubscriptionBenefits } from './api'

const instance: SubscriptionBenefits = {
  subscriptionType,
  name,
  price,
  dailyBonus,
  discountRate,
  features,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
