# GameMechanicsConfig

ゲームメカニクスの設定

## Properties

| Name                          | Type                                                      | Description                     | Notes                                                                                     |
| ----------------------------- | --------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| **battleTurnDurationSeconds** | **number**                                                | バトルの1ターンの制限時間（秒） | [optional] [default to 30]                                                                |
| **maxBattleTurns**            | **number**                                                | バトルの最大ターン数            | [optional] [default to 50]                                                                |
| **experienceGainFormula**     | **string**                                                | 経験値獲得の計算式              | [optional] [default to 'base_exp * level_multiplier']                                     |
| **damageCalculationFormula**  | **string**                                                | ダメージ計算式                  | [optional] [default to '(attacker.attack * skill_multiplier) - (defender.defense * 0.5)'] |
| **logFragmentRequirements**   | [**LogFragmentRequirements**](LogFragmentRequirements.md) |                                 | [default to undefined]                                                                    |

## Example

```typescript
import { GameMechanicsConfig } from './api'

const instance: GameMechanicsConfig = {
  battleTurnDurationSeconds,
  maxBattleTurns,
  experienceGainFormula,
  damageCalculationFormula,
  logFragmentRequirements,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
