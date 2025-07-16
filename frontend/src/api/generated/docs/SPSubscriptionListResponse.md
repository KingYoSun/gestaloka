# SPSubscriptionListResponse

サブスクリプション一覧レスポンス

## Properties

| Name               | Type                                                                 | Description | Notes                  |
| ------------------ | -------------------------------------------------------------------- | ----------- | ---------------------- |
| **subscriptions**  | [**Array&lt;SPSubscriptionResponse&gt;**](SPSubscriptionResponse.md) |             | [default to undefined] |
| **total**          | **number**                                                           |             | [default to undefined] |
| **activeCount**    | **number**                                                           |             | [default to undefined] |
| **cancelledCount** | **number**                                                           |             | [default to undefined] |

## Example

```typescript
import { SPSubscriptionListResponse } from './api'

const instance: SPSubscriptionListResponse = {
  subscriptions,
  total,
  activeCount,
  cancelledCount,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
