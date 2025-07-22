# SessionResultResponse

セッション結果レスポンス

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **string** |  | [default to undefined]
**session_id** | **string** |  | [default to undefined]
**story_summary** | **string** | GM AIが生成する物語の要約 | [default to undefined]
**key_events** | **Array&lt;string&gt;** | 重要イベントのリスト | [default to undefined]
**experience_gained** | **number** | 獲得経験値 | [default to undefined]
**skills_improved** | **{ [key: string]: number; }** | 向上したスキル（スキル名: 上昇値） | [default to undefined]
**items_acquired** | **Array&lt;string&gt;** | 獲得アイテム | [default to undefined]
**continuation_context** | **string** | 次セッションへ渡すコンテキスト | [default to undefined]
**unresolved_plots** | **Array&lt;string&gt;** | 未解決のプロット | [default to undefined]
**created_at** | **Date** |  | [default to undefined]

## Example

```typescript
import { SessionResultResponse } from './api';

const instance: SessionResultResponse = {
    id,
    session_id,
    story_summary,
    key_events,
    experience_gained,
    skills_improved,
    items_acquired,
    continuation_context,
    unresolved_plots,
    created_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
