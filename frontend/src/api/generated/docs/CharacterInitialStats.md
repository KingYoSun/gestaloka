# CharacterInitialStats

キャラクターの初期ステータス設定

## Properties

| Name           | Type       | Description | Notes                       |
| -------------- | ---------- | ----------- | --------------------------- |
| **level**      | **number** | 初期レベル  | [optional] [default to 1]   |
| **experience** | **number** | 初期経験値  | [optional] [default to 0]   |
| **health**     | **number** | 初期HP      | [optional] [default to 100] |
| **maxHealth**  | **number** | 初期最大HP  | [optional] [default to 100] |
| **mp**         | **number** | 初期MP      | [optional] [default to 100] |
| **maxMp**      | **number** | 初期最大MP  | [optional] [default to 100] |
| **attack**     | **number** | 初期攻撃力  | [optional] [default to 10]  |
| **defense**    | **number** | 初期防御力  | [optional] [default to 10]  |
| **agility**    | **number** | 初期素早さ  | [optional] [default to 10]  |

## Example

```typescript
import { CharacterInitialStats } from './api'

const instance: CharacterInitialStats = {
  level,
  experience,
  health,
  maxHealth,
  mp,
  maxMp,
  attack,
  defense,
  agility,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
