# SPSubscriptionResponse

サブスクリプションレスポンススキーマ

## Properties

| Name                     | Type                                            | Description              | Notes                             |
| ------------------------ | ----------------------------------------------- | ------------------------ | --------------------------------- |
| **subscriptionType**     | [**SPSubscriptionType**](SPSubscriptionType.md) | サブスクリプションタイプ | [default to undefined]            |
| **autoRenew**            | **boolean**                                     | 自動更新フラグ           | [optional] [default to true]      |
| **id**                   | **string**                                      |                          | [default to undefined]            |
| **userId**               | **string**                                      |                          | [default to undefined]            |
| **status**               | [**SubscriptionStatus**](SubscriptionStatus.md) |                          | [default to undefined]            |
| **startedAt**            | **string**                                      |                          | [default to undefined]            |
| **expiresAt**            | **string**                                      |                          | [default to undefined]            |
| **cancelledAt**          | **string**                                      |                          | [default to undefined]            |
| **stripeSubscriptionId** | **string**                                      |                          | [default to undefined]            |
| **stripeCustomerId**     | **string**                                      |                          | [default to undefined]            |
| **price**                | **number**                                      |                          | [default to undefined]            |
| **currency**             | **string**                                      |                          | [default to undefined]            |
| **nextBillingDate**      | **string**                                      |                          | [default to undefined]            |
| **trialEnd**             | **string**                                      |                          | [default to undefined]            |
| **createdAt**            | **string**                                      |                          | [default to undefined]            |
| **updatedAt**            | **string**                                      |                          | [default to undefined]            |
| **isActive**             | **boolean**                                     | 現在有効かどうか         | [default to undefined]            |
| **daysRemaining**        | **number**                                      |                          | [optional] [default to undefined] |
| **isTrial**              | **boolean**                                     | 試用期間中かどうか       | [optional] [default to false]     |

## Example

```typescript
import { SPSubscriptionResponse } from './api'

const instance: SPSubscriptionResponse = {
  subscriptionType,
  autoRenew,
  id,
  userId,
  status,
  startedAt,
  expiresAt,
  cancelledAt,
  stripeSubscriptionId,
  stripeCustomerId,
  price,
  currency,
  nextBillingDate,
  trialEnd,
  createdAt,
  updatedAt,
  isActive,
  daysRemaining,
  isTrial,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
