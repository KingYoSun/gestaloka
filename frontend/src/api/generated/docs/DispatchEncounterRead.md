# DispatchEncounterRead

遭遇記録の読み取り

## Properties

| Name                       | Type                    | Description | Notes                  |
| -------------------------- | ----------------------- | ----------- | ---------------------- |
| **id**                     | **string**              |             | [default to undefined] |
| **dispatchId**             | **string**              |             | [default to undefined] |
| **encounteredCharacterId** | **string**              |             | [default to undefined] |
| **encounteredNpcName**     | **string**              |             | [default to undefined] |
| **location**               | **string**              |             | [default to undefined] |
| **interactionType**        | **string**              |             | [default to undefined] |
| **interactionSummary**     | **string**              |             | [default to undefined] |
| **outcome**                | **string**              |             | [default to undefined] |
| **relationshipChange**     | **number**              |             | [default to undefined] |
| **itemsExchanged**         | **Array&lt;string&gt;** |             | [default to undefined] |
| **occurredAt**             | **string**              |             | [default to undefined] |

## Example

```typescript
import { DispatchEncounterRead } from './api'

const instance: DispatchEncounterRead = {
  id,
  dispatchId,
  encounteredCharacterId,
  encounteredNpcName,
  location,
  interactionType,
  interactionSummary,
  outcome,
  relationshipChange,
  itemsExchanged,
  occurredAt,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
