# GameConfig

ゲーム設定

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**max_characters_per_user** | **number** | ユーザーが作成できる最大キャラクター数 | [optional] [default to 5]
**character_initial_stats** | [**CharacterInitialStats**](CharacterInitialStats.md) | キャラクターの初期ステータス | [default to undefined]
**game_mechanics** | [**GameMechanicsConfig**](GameMechanicsConfig.md) |  | [default to undefined]

## Example

```typescript
import { GameConfig } from './api';

const instance: GameConfig = {
    max_characters_per_user,
    character_initial_stats,
    game_mechanics,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
