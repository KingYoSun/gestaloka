# NarrativeResponse

物語生成のレスポンス

## Properties

| Name                | Type                                               | Description            | Notes                             |
| ------------------- | -------------------------------------------------- | ---------------------- | --------------------------------- |
| **narrative**       | **string**                                         | 生成された物語テキスト | [default to undefined]            |
| **locationChanged** | **boolean**                                        | 場所が変更されたか     | [optional] [default to false]     |
| **newLocationId**   | **string**                                         |                        | [optional] [default to undefined] |
| **newLocationName** | **string**                                         |                        | [optional] [default to undefined] |
| **spConsumed**      | **number**                                         | 消費されたSP           | [optional] [default to 0]         |
| **actionChoices**   | [**Array&lt;ActionChoice&gt;**](ActionChoice.md)   | 次の行動選択肢         | [default to undefined]            |
| **events**          | [**Array&lt;LocationEvent&gt;**](LocationEvent.md) |                        | [optional] [default to undefined] |

## Example

```typescript
import { NarrativeResponse } from './api'

const instance: NarrativeResponse = {
  narrative,
  locationChanged,
  newLocationId,
  newLocationName,
  spConsumed,
  actionChoices,
  events,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
