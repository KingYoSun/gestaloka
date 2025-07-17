# DispatchEncounterRead

遭遇記録の読み取り

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **string** |  | [default to undefined]
**dispatch_id** | **string** |  | [default to undefined]
**encountered_character_id** | **string** |  | [default to undefined]
**encountered_npc_name** | **string** |  | [default to undefined]
**location** | **string** |  | [default to undefined]
**interaction_type** | **string** |  | [default to undefined]
**interaction_summary** | **string** |  | [default to undefined]
**outcome** | **string** |  | [default to undefined]
**relationship_change** | **number** |  | [default to undefined]
**items_exchanged** | **Array&lt;string&gt;** |  | [default to undefined]
**occurred_at** | **Date** |  | [default to undefined]

## Example

```typescript
import { DispatchEncounterRead } from './api';

const instance: DispatchEncounterRead = {
    id,
    dispatch_id,
    encountered_character_id,
    encountered_npc_name,
    location,
    interaction_type,
    interaction_summary,
    outcome,
    relationship_change,
    items_exchanged,
    occurred_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
