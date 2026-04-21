# CompletedLogRead

完成ログ読み取りスキーマ

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **string** | ログの名前 | [default to undefined]
**title** | **string** |  | [optional] [default to undefined]
**description** | **string** | ログの説明文 | [default to undefined]
**skills** | **Array&lt;string&gt;** | 獲得したスキル | [optional] [default to undefined]
**personality_traits** | **Array&lt;string&gt;** | 性格特性 | [optional] [default to undefined]
**behavior_patterns** | **object** | 行動パターン | [optional] [default to undefined]
**id** | **string** |  | [default to undefined]
**creator_id** | **string** |  | [default to undefined]
**core_fragment_id** | **string** |  | [default to undefined]
**contamination_level** | **number** |  | [default to undefined]
**status** | [**CompletedLogStatus**](CompletedLogStatus.md) |  | [default to undefined]
**created_at** | **Date** |  | [default to undefined]
**completed_at** | **Date** |  | [default to undefined]

## Example

```typescript
import { CompletedLogRead } from './api';

const instance: CompletedLogRead = {
    name,
    title,
    description,
    skills,
    personality_traits,
    behavior_patterns,
    id,
    creator_id,
    core_fragment_id,
    contamination_level,
    status,
    created_at,
    completed_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
