# NPCProfile

NPCプロファイル

## Properties

| Name                   | Type                    | Description          | Notes                             |
| ---------------------- | ----------------------- | -------------------- | --------------------------------- |
| **npcId**              | **string**              | NPCの一意識別子      | [default to undefined]            |
| **name**               | **string**              | NPCの名前            | [default to undefined]            |
| **title**              | **string**              |                      | [optional] [default to undefined] |
| **npcType**            | **string**              | NPCのタイプ          | [default to undefined]            |
| **personalityTraits**  | **Array&lt;string&gt;** | 性格特性のリスト     | [optional] [default to undefined] |
| **behaviorPatterns**   | **Array&lt;string&gt;** | 行動パターンのリスト | [optional] [default to undefined] |
| **skills**             | **Array&lt;string&gt;** | スキルのリスト       | [optional] [default to undefined] |
| **appearance**         | **string**              |                      | [optional] [default to undefined] |
| **backstory**          | **string**              |                      | [optional] [default to undefined] |
| **originalPlayer**     | **string**              |                      | [optional] [default to undefined] |
| **logSource**          | **string**              |                      | [optional] [default to undefined] |
| **contaminationLevel** | **number**              | 汚染度               | [optional] [default to 0]         |
| **persistenceLevel**   | **number**              | 永続性レベル（1-10） | [optional] [default to 5]         |
| **currentLocation**    | **string**              |                      | [optional] [default to undefined] |
| **isActive**           | **boolean**             | アクティブかどうか   | [optional] [default to true]      |

## Example

```typescript
import { NPCProfile } from './api'

const instance: NPCProfile = {
  npcId,
  name,
  title,
  npcType,
  personalityTraits,
  behaviorPatterns,
  skills,
  appearance,
  backstory,
  originalPlayer,
  logSource,
  contaminationLevel,
  persistenceLevel,
  currentLocation,
  isActive,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
