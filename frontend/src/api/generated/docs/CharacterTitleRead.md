# CharacterTitleRead

Schema for reading a character title.

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**title** | **string** |  | [default to undefined]
**description** | **string** |  | [default to undefined]
**effects** | **object** |  | [optional] [default to undefined]
**is_equipped** | **boolean** |  | [optional] [default to false]
**id** | **string** |  | [default to undefined]
**character_id** | **string** |  | [default to undefined]
**acquired_at** | **string** |  | [default to undefined]
**created_at** | **Date** |  | [default to undefined]
**updated_at** | **Date** |  | [default to undefined]

## Example

```typescript
import { CharacterTitleRead } from './api';

const instance: CharacterTitleRead = {
    title,
    description,
    effects,
    is_equipped,
    id,
    character_id,
    acquired_at,
    created_at,
    updated_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
