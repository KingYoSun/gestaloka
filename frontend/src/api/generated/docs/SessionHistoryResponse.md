# SessionHistoryResponse

セッション履歴レスポンス

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**sessions** | [**Array&lt;SessionHistoryItem&gt;**](SessionHistoryItem.md) |  | [default to undefined]
**total** | **number** |  | [default to undefined]
**page** | **number** | 現在のページ番号 | [default to undefined]
**per_page** | **number** | 1ページあたりのアイテム数 | [default to undefined]
**has_next** | **boolean** | 次のページが存在するか | [default to undefined]
**has_prev** | **boolean** | 前のページが存在するか | [default to undefined]

## Example

```typescript
import { SessionHistoryResponse } from './api';

const instance: SessionHistoryResponse = {
    sessions,
    total,
    page,
    per_page,
    has_next,
    has_prev,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
