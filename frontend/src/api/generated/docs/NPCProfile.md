# NPCProfile

NPCプロファイル

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**npc_id** | **string** | NPCの一意識別子 | [default to undefined]
**name** | **string** | NPCの名前 | [default to undefined]
**title** | **string** |  | [optional] [default to undefined]
**npc_type** | **string** | NPCのタイプ | [default to undefined]
**personality_traits** | **Array&lt;string&gt;** | 性格特性のリスト | [optional] [default to undefined]
**behavior_patterns** | **Array&lt;string&gt;** | 行動パターンのリスト | [optional] [default to undefined]
**skills** | **Array&lt;string&gt;** | スキルのリスト | [optional] [default to undefined]
**appearance** | **string** |  | [optional] [default to undefined]
**backstory** | **string** |  | [optional] [default to undefined]
**original_player** | **string** |  | [optional] [default to undefined]
**log_source** | **string** |  | [optional] [default to undefined]
**contamination_level** | **number** | 汚染度 | [optional] [default to 0]
**persistence_level** | **number** | 永続性レベル（1-10） | [optional] [default to 5]
**current_location** | **string** |  | [optional] [default to undefined]
**is_active** | **boolean** | アクティブかどうか | [optional] [default to true]

## Example

```typescript
import { NPCProfile } from './api';

const instance: NPCProfile = {
    npc_id,
    name,
    title,
    npc_type,
    personality_traits,
    behavior_patterns,
    skills,
    appearance,
    backstory,
    original_player,
    log_source,
    contamination_level,
    persistence_level,
    current_location,
    is_active,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
