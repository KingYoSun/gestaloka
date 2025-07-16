# DispatchReportRead

派遣報告書の読み取り

## Properties

| Name                         | Type                    | Description | Notes                  |
| ---------------------------- | ----------------------- | ----------- | ---------------------- |
| **id**                       | **string**              |             | [default to undefined] |
| **dispatchId**               | **string**              |             | [default to undefined] |
| **totalDistanceTraveled**    | **number**              |             | [default to undefined] |
| **totalEncounters**          | **number**              |             | [default to undefined] |
| **totalItemsCollected**      | **number**              |             | [default to undefined] |
| **totalLocationsDiscovered** | **number**              |             | [default to undefined] |
| **objectiveCompletionRate**  | **number**              |             | [default to undefined] |
| **memorableMoments**         | **Array&lt;object&gt;** |             | [default to undefined] |
| **personalityChanges**       | **Array&lt;string&gt;** |             | [default to undefined] |
| **newSkillsLearned**         | **Array&lt;string&gt;** |             | [default to undefined] |
| **narrativeSummary**         | **string**              |             | [default to undefined] |
| **epilogue**                 | **string**              |             | [default to undefined] |
| **createdAt**                | **string**              |             | [default to undefined] |

## Example

```typescript
import { DispatchReportRead } from './api'

const instance: DispatchReportRead = {
  id,
  dispatchId,
  totalDistanceTraveled,
  totalEncounters,
  totalItemsCollected,
  totalLocationsDiscovered,
  objectiveCompletionRate,
  memorableMoments,
  personalityChanges,
  newSkillsLearned,
  narrativeSummary,
  epilogue,
  createdAt,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
