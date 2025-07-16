# CharacterStats

キャラクターステータススキーマ

## Properties

| Name            | Type       | Description | Notes                       |
| --------------- | ---------- | ----------- | --------------------------- |
| **level**       | **number** | レベル      | [optional] [default to 1]   |
| **experience**  | **number** | 経験値      | [optional] [default to 0]   |
| **health**      | **number** | 現在HP      | [optional] [default to 100] |
| **maxHealth**   | **number** | 最大HP      | [optional] [default to 100] |
| **mp**          | **number** | 現在MP      | [optional] [default to 100] |
| **maxMp**       | **number** | 最大MP      | [optional] [default to 100] |
| **id**          | **string** |             | [default to undefined]      |
| **characterId** | **string** |             | [default to undefined]      |

## Example

```typescript
import { CharacterStats } from './api'

const instance: CharacterStats = {
  level,
  experience,
  health,
  maxHealth,
  mp,
  maxMp,
  id,
  characterId,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
