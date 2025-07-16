# Character

キャラクタースキーマ（レスポンス用）

## Properties

| Name             | Type                                    | Description    | Notes                             |
| ---------------- | --------------------------------------- | -------------- | --------------------------------- |
| **name**         | **string**                              | キャラクター名 | [default to undefined]            |
| **description**  | **string**                              |                | [optional] [default to undefined] |
| **appearance**   | **string**                              |                | [optional] [default to undefined] |
| **personality**  | **string**                              |                | [optional] [default to undefined] |
| **location**     | **string**                              | 現在地         | [optional] [default to 'nexus']   |
| **id**           | **string**                              |                | [default to undefined]            |
| **userId**       | **string**                              |                | [default to undefined]            |
| **stats**        | [**CharacterStats**](CharacterStats.md) |                | [optional] [default to undefined] |
| **skills**       | [**Array&lt;Skill&gt;**](Skill.md)      |                | [optional] [default to undefined] |
| **isActive**     | **boolean**                             |                | [optional] [default to true]      |
| **createdAt**    | **string**                              |                | [default to undefined]            |
| **updatedAt**    | **string**                              |                | [default to undefined]            |
| **lastPlayedAt** | **string**                              |                | [optional] [default to undefined] |

## Example

```typescript
import { Character } from './api'

const instance: Character = {
  name,
  description,
  appearance,
  personality,
  location,
  id,
  userId,
  stats,
  skills,
  isActive,
  createdAt,
  updatedAt,
  lastPlayedAt,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
