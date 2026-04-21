# Quest

動的クエストモデル

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **string** | クエストの一意識別子 | [optional] [default to undefined]
**character_id** | **string** | クエストを保持するキャラクターID | [default to undefined]
**session_id** | **string** |  | [optional] [default to undefined]
**title** | **string** | クエストのタイトル（動的に更新可能、最大100文字） | [default to undefined]
**description** | **string** | クエストの説明（動的に更新される、最大2500文字） | [default to undefined]
**status** | [**QuestStatus**](QuestStatus.md) | クエストの現在の状態 | [optional] [default to undefined]
**origin** | [**QuestOrigin**](QuestOrigin.md) | クエストがどのように発生したか | [default to undefined]
**progress_percentage** | **number** | 進行度（0-100%） | [optional] [default to 0.0]
**narrative_completeness** | **number** | 物語的完結度（0-1） | [optional] [default to 0.0]
**emotional_satisfaction** | **number** | 感情的満足度（0-1） | [optional] [default to 0.5]
**key_events** | **Array&lt;object&gt;** | 関連する重要イベントのリスト | [optional] [default to undefined]
**progress_indicators** | **object** | 進行度を示す各種指標 | [optional] [default to undefined]
**emotional_arc** | **Array&lt;object&gt;** | 物語の感情的な流れ | [optional] [default to undefined]
**involved_entities** | **{ [key: string]: Array&lt;string&gt;; }** | 関わったエンティティ（NPC、場所、アイテム） | [optional] [default to undefined]
**context_summary** | **string** |  | [optional] [default to undefined]
**completion_summary** | **string** |  | [optional] [default to undefined]
**proposed_at** | **Date** | クエストが提案された日時 | [optional] [default to undefined]
**started_at** | **Date** |  | [optional] [default to undefined]
**completed_at** | **Date** |  | [optional] [default to undefined]
**last_progress_at** | **Date** | 最後に進行があった日時 | [optional] [default to undefined]

## Example

```typescript
import { Quest } from './api';

const instance: Quest = {
    id,
    character_id,
    session_id,
    title,
    description,
    status,
    origin,
    progress_percentage,
    narrative_completeness,
    emotional_satisfaction,
    key_events,
    progress_indicators,
    emotional_arc,
    involved_entities,
    context_summary,
    completion_summary,
    proposed_at,
    started_at,
    completed_at,
    last_progress_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
