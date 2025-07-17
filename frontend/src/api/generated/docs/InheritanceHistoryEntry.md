# InheritanceHistoryEntry

継承履歴エントリ

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **string** | 履歴ID | [default to undefined]
**timestamp** | **string** | 継承実行日時 | [default to undefined]
**fragment_ids** | **Array&lt;string&gt;** | 使用した記憶フラグメントのIDリスト | [default to undefined]
**inheritance_type** | **string** | 継承タイプ | [default to undefined]
**result** | **object** | 継承結果 | [default to undefined]

## Example

```typescript
import { InheritanceHistoryEntry } from './api';

const instance: InheritanceHistoryEntry = {
    id,
    timestamp,
    fragment_ids,
    inheritance_type,
    result,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
