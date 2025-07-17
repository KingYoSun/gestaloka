# DispatchReportRead

派遣報告書の読み取り

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **string** |  | [default to undefined]
**dispatch_id** | **string** |  | [default to undefined]
**total_distance_traveled** | **number** |  | [default to undefined]
**total_encounters** | **number** |  | [default to undefined]
**total_items_collected** | **number** |  | [default to undefined]
**total_locations_discovered** | **number** |  | [default to undefined]
**objective_completion_rate** | **number** |  | [default to undefined]
**memorable_moments** | **Array&lt;object&gt;** |  | [default to undefined]
**personality_changes** | **Array&lt;string&gt;** |  | [default to undefined]
**new_skills_learned** | **Array&lt;string&gt;** |  | [default to undefined]
**narrative_summary** | **string** |  | [default to undefined]
**epilogue** | **string** |  | [default to undefined]
**created_at** | **Date** |  | [default to undefined]

## Example

```typescript
import { DispatchReportRead } from './api';

const instance: DispatchReportRead = {
    id,
    dispatch_id,
    total_distance_traveled,
    total_encounters,
    total_items_collected,
    total_locations_discovered,
    objective_completion_rate,
    memorable_moments,
    personality_changes,
    new_skills_learned,
    narrative_summary,
    epilogue,
    created_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
