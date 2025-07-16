# AdminSPAdjustmentResponse

SP調整レスポンス

## Properties

| Name                 | Type       | Description | Notes                             |
| -------------------- | ---------- | ----------- | --------------------------------- |
| **userId**           | **number** |             | [default to undefined]            |
| **username**         | **string** |             | [default to undefined]            |
| **previousSp**       | **number** |             | [default to undefined]            |
| **currentSp**        | **number** |             | [default to undefined]            |
| **adjustmentAmount** | **number** |             | [default to undefined]            |
| **reason**           | **string** |             | [default to undefined]            |
| **adjustedBy**       | **string** |             | [default to undefined]            |
| **adjustedAt**       | **string** |             | [optional] [default to undefined] |

## Example

```typescript
import { AdminSPAdjustmentResponse } from './api'

const instance: AdminSPAdjustmentResponse = {
  userId,
  username,
  previousSp,
  currentSp,
  adjustmentAmount,
  reason,
  adjustedBy,
  adjustedAt,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
