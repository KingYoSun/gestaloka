# SPDailyRecoveryResponse

SP日次回復レスポンススキーマ

## Properties

| Name                | Type        | Description | Notes                  |
| ------------------- | ----------- | ----------- | ---------------------- |
| **success**         | **boolean** |             | [default to undefined] |
| **recoveredAmount** | **number**  |             | [default to undefined] |
| **loginBonus**      | **number**  |             | [default to undefined] |
| **consecutiveDays** | **number**  |             | [default to undefined] |
| **totalAmount**     | **number**  |             | [default to undefined] |
| **balanceAfter**    | **number**  |             | [default to undefined] |
| **message**         | **string**  |             | [default to undefined] |

## Example

```typescript
import { SPDailyRecoveryResponse } from './api'

const instance: SPDailyRecoveryResponse = {
  success,
  recoveredAmount,
  loginBonus,
  consecutiveDays,
  totalAmount,
  balanceAfter,
  message,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
