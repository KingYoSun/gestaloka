# SPPlanResponse

SPプラン一覧レスポンス

## Properties

| Name            | Type                                 | Description | Notes                         |
| --------------- | ------------------------------------ | ----------- | ----------------------------- |
| **plans**       | [**Array&lt;SPPlan&gt;**](SPPlan.md) |             | [default to undefined]        |
| **paymentMode** | **string**                           |             | [default to undefined]        |
| **currency**    | **string**                           |             | [optional] [default to 'JPY'] |

## Example

```typescript
import { SPPlanResponse } from './api'

const instance: SPPlanResponse = {
  plans,
  paymentMode,
  currency,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
