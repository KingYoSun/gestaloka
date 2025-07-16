# LogFragmentRequirements

ログの欠片に関する設定

## Properties

| Name                                | Type       | Description                        | Notes                      |
| ----------------------------------- | ---------- | ---------------------------------- | -------------------------- |
| **minFragmentsForCompletion**       | **number** | ログ完成に必要な最小欠片数         | [optional] [default to 3]  |
| **maxFragmentsForCompletion**       | **number** | ログ完成に必要な最大欠片数         | [optional] [default to 10] |
| **fragmentGenerationCooldownHours** | **number** | 欠片生成のクールダウン時間（時間） | [optional] [default to 24] |
| **maxActiveContracts**              | **number** | 同時に持てる最大契約数             | [optional] [default to 5]  |

## Example

```typescript
import { LogFragmentRequirements } from './api'

const instance: LogFragmentRequirements = {
  minFragmentsForCompletion,
  maxFragmentsForCompletion,
  fragmentGenerationCooldownHours,
  maxActiveContracts,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
