# CharacterStats

キャラクターステータススキーマ

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**level** | **number** | レベル | [optional] [default to 1]
**experience** | **number** | 経験値 | [optional] [default to 0]
**health** | **number** | 現在HP | [optional] [default to 100]
**max_health** | **number** | 最大HP | [optional] [default to 100]
**mp** | **number** | 現在MP | [optional] [default to 100]
**max_mp** | **number** | 最大MP | [optional] [default to 100]
**id** | **string** |  | [default to undefined]
**character_id** | **string** |  | [default to undefined]

## Example

```typescript
import { CharacterStats } from './api';

const instance: CharacterStats = {
    level,
    experience,
    health,
    max_health,
    mp,
    max_mp,
    id,
    character_id,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
