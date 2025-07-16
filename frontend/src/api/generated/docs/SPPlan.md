# SPPlan

SPプラン

## Properties

| Name                | Type        | Description | Notes                         |
| ------------------- | ----------- | ----------- | ----------------------------- |
| **id**              | **string**  |             | [default to undefined]        |
| **name**            | **string**  |             | [default to undefined]        |
| **spAmount**        | **number**  |             | [default to undefined]        |
| **priceJpy**        | **number**  |             | [default to undefined]        |
| **bonusPercentage** | **number**  |             | [default to undefined]        |
| **popular**         | **boolean** |             | [optional] [default to false] |
| **description**     | **string**  |             | [optional] [default to '']    |

## Example

```typescript
import { SPPlan } from './api'

const instance: SPPlan = {
  id,
  name,
  spAmount,
  priceJpy,
  bonusPercentage,
  popular,
  description,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
