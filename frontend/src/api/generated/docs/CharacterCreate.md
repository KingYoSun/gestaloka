# CharacterCreate

キャラクター作成スキーマ

## Properties

| Name            | Type       | Description    | Notes                             |
| --------------- | ---------- | -------------- | --------------------------------- |
| **name**        | **string** | キャラクター名 | [default to undefined]            |
| **description** | **string** |                | [optional] [default to undefined] |
| **appearance**  | **string** |                | [optional] [default to undefined] |
| **personality** | **string** |                | [optional] [default to undefined] |
| **location**    | **string** | 現在地         | [optional] [default to 'nexus']   |

## Example

```typescript
import { CharacterCreate } from './api'

const instance: CharacterCreate = {
  name,
  description,
  appearance,
  personality,
  location,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
