# CharacterTitleRead

Schema for reading a character title.

## Properties

| Name            | Type        | Description | Notes                             |
| --------------- | ----------- | ----------- | --------------------------------- |
| **title**       | **string**  |             | [default to undefined]            |
| **description** | **string**  |             | [default to undefined]            |
| **effects**     | **object**  |             | [optional] [default to undefined] |
| **isEquipped**  | **boolean** |             | [optional] [default to false]     |
| **id**          | **string**  |             | [default to undefined]            |
| **characterId** | **string**  |             | [default to undefined]            |
| **acquiredAt**  | **string**  |             | [default to undefined]            |
| **createdAt**   | **string**  |             | [default to undefined]            |
| **updatedAt**   | **string**  |             | [default to undefined]            |

## Example

```typescript
import { CharacterTitleRead } from './api'

const instance: CharacterTitleRead = {
  title,
  description,
  effects,
  isEquipped,
  id,
  characterId,
  acquiredAt,
  createdAt,
  updatedAt,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
