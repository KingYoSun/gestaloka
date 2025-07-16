# SubscriptionPlansResponse

サブスクリプションプラン一覧レスポンス

## Properties

| Name                    | Type                                                             | Description | Notes                             |
| ----------------------- | ---------------------------------------------------------------- | ----------- | --------------------------------- |
| **plans**               | [**Array&lt;SubscriptionBenefits&gt;**](SubscriptionBenefits.md) |             | [default to undefined]            |
| **currentSubscription** | [**SPSubscriptionResponse**](SPSubscriptionResponse.md)          |             | [optional] [default to undefined] |

## Example

```typescript
import { SubscriptionPlansResponse } from './api'

const instance: SubscriptionPlansResponse = {
  plans,
  currentSubscription,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
