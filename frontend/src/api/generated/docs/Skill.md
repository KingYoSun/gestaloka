# Skill

スキルスキーマ

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **string** | スキル名 | [default to undefined]
**level** | **number** | スキルレベル | [optional] [default to 1]
**experience** | **number** | スキル経験値 | [optional] [default to 0]
**description** | **string** |  | [optional] [default to undefined]
**id** | **string** |  | [default to undefined]
**character_id** | **string** |  | [default to undefined]

## Example

```typescript
import { Skill } from './api';

const instance: Skill = {
    name,
    level,
    experience,
    description,
    id,
    character_id,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
