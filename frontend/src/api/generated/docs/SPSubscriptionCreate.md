# SPSubscriptionCreate

サブスクリプション作成スキーマ

## Properties

| Name                 | Type                                            | Description              | Notes                             |
| -------------------- | ----------------------------------------------- | ------------------------ | --------------------------------- |
| **subscriptionType** | [**SPSubscriptionType**](SPSubscriptionType.md) | サブスクリプションタイプ | [default to undefined]            |
| **autoRenew**        | **boolean**                                     | 自動更新フラグ           | [optional] [default to true]      |
| **paymentMethodId**  | **string**                                      |                          | [optional] [default to undefined] |
| **trialDays**        | **number**                                      |                          | [optional] [default to undefined] |

## Example

```typescript
import { SPSubscriptionCreate } from './api'

const instance: SPSubscriptionCreate = {
  subscriptionType,
  autoRenew,
  paymentMethodId,
  trialDays,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
