# DispatchCreate

派遣作成時の入力

## Properties

| Name                     | Type                                                  | Description              | Notes                  |
| ------------------------ | ----------------------------------------------------- | ------------------------ | ---------------------- |
| **completedLogId**       | **string**                                            | 派遣する完成ログのID     | [default to undefined] |
| **dispatcherId**         | **string**                                            | 派遣するキャラクターのID | [default to undefined] |
| **objectiveType**        | [**DispatchObjectiveType**](DispatchObjectiveType.md) | 派遣目的                 | [default to undefined] |
| **objectiveDetail**      | **string**                                            | 具体的な目的の説明       | [default to undefined] |
| **initialLocation**      | **string**                                            | 初期スポーン地点         | [default to undefined] |
| **dispatchDurationDays** | **number**                                            | 派遣期間（日）           | [default to undefined] |

## Example

```typescript
import { DispatchCreate } from './api'

const instance: DispatchCreate = {
  completedLogId,
  dispatcherId,
  objectiveType,
  objectiveDetail,
  initialLocation,
  dispatchDurationDays,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
