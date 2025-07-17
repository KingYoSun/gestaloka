# Character

キャラクタースキーマ（レスポンス用）

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **string** | キャラクター名 | [default to undefined]
**description** | **string** |  | [optional] [default to undefined]
**appearance** | **string** |  | [optional] [default to undefined]
**personality** | **string** |  | [optional] [default to undefined]
**location** | **string** | 現在地 | [optional] [default to 'nexus']
**id** | **string** |  | [default to undefined]
**user_id** | **string** |  | [default to undefined]
**stats** | [**CharacterStats**](CharacterStats.md) |  | [optional] [default to undefined]
**skills** | [**Array&lt;Skill&gt;**](Skill.md) |  | [optional] [default to undefined]
**is_active** | **boolean** |  | [optional] [default to true]
**created_at** | **Date** |  | [default to undefined]
**updated_at** | **Date** |  | [default to undefined]
**last_played_at** | **Date** |  | [optional] [default to undefined]

## Example

```typescript
import { Character } from './api';

const instance: Character = {
    name,
    description,
    appearance,
    personality,
    location,
    id,
    user_id,
    stats,
    skills,
    is_active,
    created_at,
    updated_at,
    last_played_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
