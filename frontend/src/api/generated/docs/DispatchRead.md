# DispatchRead

派遣情報の読み取り

## Properties

| Name                     | Type                                                  | Description              | Notes                  |
| ------------------------ | ----------------------------------------------------- | ------------------------ | ---------------------- |
| **completedLogId**       | **string**                                            | 派遣する完成ログのID     | [default to undefined] |
| **dispatcherId**         | **string**                                            | 派遣するキャラクターのID | [default to undefined] |
| **objectiveType**        | [**DispatchObjectiveType**](DispatchObjectiveType.md) | 派遣目的                 | [default to undefined] |
| **objectiveDetail**      | **string**                                            | 具体的な目的の説明       | [default to undefined] |
| **initialLocation**      | **string**                                            | 初期スポーン地点         | [default to undefined] |
| **dispatchDurationDays** | **number**                                            | 派遣期間（日）           | [default to undefined] |
| **id**                   | **string**                                            |                          | [default to undefined] |
| **spCost**               | **number**                                            | 消費SP                   | [default to undefined] |
| **status**               | [**DispatchStatus**](DispatchStatus.md)               |                          | [default to undefined] |
| **travelLog**            | **Array&lt;object&gt;**                               | 時系列の活動記録         | [default to undefined] |
| **collectedItems**       | **Array&lt;object&gt;**                               | 収集したアイテム         | [default to undefined] |
| **discoveredLocations**  | **Array&lt;string&gt;**                               | 発見した場所             | [default to undefined] |
| **spRefundAmount**       | **number**                                            | SP還元量                 | [default to undefined] |
| **achievementScore**     | **number**                                            | 達成度スコア（0.0-1.0）  | [default to undefined] |
| **createdAt**            | **string**                                            |                          | [default to undefined] |
| **dispatchedAt**         | **string**                                            |                          | [default to undefined] |
| **expectedReturnAt**     | **string**                                            |                          | [default to undefined] |
| **actualReturnAt**       | **string**                                            |                          | [default to undefined] |

## Example

```typescript
import { DispatchRead } from './api'

const instance: DispatchRead = {
  completedLogId,
  dispatcherId,
  objectiveType,
  objectiveDetail,
  initialLocation,
  dispatchDurationDays,
  id,
  spCost,
  status,
  travelLog,
  collectedItems,
  discoveredLocations,
  spRefundAmount,
  achievementScore,
  createdAt,
  dispatchedAt,
  expectedReturnAt,
  actualReturnAt,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
