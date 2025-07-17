# GameMechanicsConfig

ゲームメカニクスの設定

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**battle_turn_duration_seconds** | **number** | バトルの1ターンの制限時間（秒） | [optional] [default to 30]
**max_battle_turns** | **number** | バトルの最大ターン数 | [optional] [default to 50]
**experience_gain_formula** | **string** | 経験値獲得の計算式 | [optional] [default to 'base_exp * level_multiplier']
**damage_calculation_formula** | **string** | ダメージ計算式 | [optional] [default to '(attacker.attack * skill_multiplier) - (defender.defense * 0.5)']
**log_fragment_requirements** | [**LogFragmentRequirements**](LogFragmentRequirements.md) |  | [default to undefined]

## Example

```typescript
import { GameMechanicsConfig } from './api';

const instance: GameMechanicsConfig = {
    battle_turn_duration_seconds,
    max_battle_turns,
    experience_gain_formula,
    damage_calculation_formula,
    log_fragment_requirements,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
