# SessionHistoryItem

セッション履歴アイテム

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **string** |  | [default to undefined]
**session_number** | **number** |  | [default to undefined]
**session_status** | **string** |  | [default to undefined]
**play_duration_minutes** | **number** |  | [default to undefined]
**turn_count** | **number** |  | [default to undefined]
**word_count** | **number** |  | [default to undefined]
**result_summary** | **string** |  | [optional] [default to undefined]
**created_at** | **Date** |  | [default to undefined]
**updated_at** | **Date** |  | [default to undefined]
**result_processed_at** | **Date** |  | [optional] [default to undefined]

## Example

```typescript
import { SessionHistoryItem } from './api';

const instance: SessionHistoryItem = {
    id,
    session_number,
    session_status,
    play_duration_minutes,
    turn_count,
    word_count,
    result_summary,
    created_at,
    updated_at,
    result_processed_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
