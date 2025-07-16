# Quest

動的クエストモデル

## Properties

| Name                      | Type                                        | Description                                       | Notes                             |
| ------------------------- | ------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| **id**                    | **string**                                  | クエストの一意識別子                              | [optional] [default to undefined] |
| **characterId**           | **string**                                  | クエストを保持するキャラクターID                  | [default to undefined]            |
| **sessionId**             | **string**                                  |                                                   | [optional] [default to undefined] |
| **title**                 | **string**                                  | クエストのタイトル（動的に更新可能、最大100文字） | [default to undefined]            |
| **description**           | **string**                                  | クエストの説明（動的に更新される、最大2500文字）  | [default to undefined]            |
| **status**                | [**QuestStatus**](QuestStatus.md)           | クエストの現在の状態                              | [optional] [default to undefined] |
| **origin**                | [**QuestOrigin**](QuestOrigin.md)           | クエストがどのように発生したか                    | [default to undefined]            |
| **progressPercentage**    | **number**                                  | 進行度（0-100%）                                  | [optional] [default to 0.0]       |
| **narrativeCompleteness** | **number**                                  | 物語的完結度（0-1）                               | [optional] [default to 0.0]       |
| **emotionalSatisfaction** | **number**                                  | 感情的満足度（0-1）                               | [optional] [default to 0.5]       |
| **keyEvents**             | **Array&lt;object&gt;**                     | 関連する重要イベントのリスト                      | [optional] [default to undefined] |
| **progressIndicators**    | **object**                                  | 進行度を示す各種指標                              | [optional] [default to undefined] |
| **emotionalArc**          | **Array&lt;object&gt;**                     | 物語の感情的な流れ                                | [optional] [default to undefined] |
| **involvedEntities**      | **{ [key: string]: Array&lt;string&gt;; }** | 関わったエンティティ（NPC、場所、アイテム）       | [optional] [default to undefined] |
| **contextSummary**        | **string**                                  |                                                   | [optional] [default to undefined] |
| **completionSummary**     | **string**                                  |                                                   | [optional] [default to undefined] |
| **proposedAt**            | **string**                                  | クエストが提案された日時                          | [optional] [default to undefined] |
| **startedAt**             | **string**                                  |                                                   | [optional] [default to undefined] |
| **completedAt**           | **string**                                  |                                                   | [optional] [default to undefined] |
| **lastProgressAt**        | **string**                                  | 最後に進行があった日時                            | [optional] [default to undefined] |

## Example

```typescript
import { Quest } from './api'

const instance: Quest = {
  id,
  characterId,
  sessionId,
  title,
  description,
  status,
  origin,
  progressPercentage,
  narrativeCompleteness,
  emotionalSatisfaction,
  keyEvents,
  progressIndicators,
  emotionalArc,
  involvedEntities,
  contextSummary,
  completionSummary,
  proposedAt,
  startedAt,
  completedAt,
  lastProgressAt,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
