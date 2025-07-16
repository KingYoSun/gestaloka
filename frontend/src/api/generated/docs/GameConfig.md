# GameConfig

ゲーム設定

## Properties

| Name                      | Type                                                  | Description                            | Notes                     |
| ------------------------- | ----------------------------------------------------- | -------------------------------------- | ------------------------- |
| **maxCharactersPerUser**  | **number**                                            | ユーザーが作成できる最大キャラクター数 | [optional] [default to 5] |
| **characterInitialStats** | [**CharacterInitialStats**](CharacterInitialStats.md) | キャラクターの初期ステータス           | [default to undefined]    |
| **gameMechanics**         | [**GameMechanicsConfig**](GameMechanicsConfig.md)     |                                        | [default to undefined]    |

## Example

```typescript
import { GameConfig } from './api'

const instance: GameConfig = {
  maxCharactersPerUser,
  characterInitialStats,
  gameMechanics,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
