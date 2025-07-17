# CompletedLogCreate

完成ログ作成スキーマ

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **string** | ログの名前 | [default to undefined]
**title** | **string** |  | [optional] [default to undefined]
**description** | **string** | ログの説明文 | [default to undefined]
**skills** | **Array&lt;string&gt;** | 獲得したスキル | [optional] [default to undefined]
**personality_traits** | **Array&lt;string&gt;** | 性格特性 | [optional] [default to undefined]
**behavior_patterns** | **object** | 行動パターン | [optional] [default to undefined]
**creator_id** | **string** |  | [default to undefined]
**core_fragment_id** | **string** |  | [default to undefined]
**sub_fragment_ids** | **Array&lt;string&gt;** | サブフラグメントのIDリスト | [optional] [default to undefined]

## Example

```typescript
import { CompletedLogCreate } from './api';

const instance: CompletedLogCreate = {
    name,
    title,
    description,
    skills,
    personality_traits,
    behavior_patterns,
    creator_id,
    core_fragment_id,
    sub_fragment_ids,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
