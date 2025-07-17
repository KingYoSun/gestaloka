# DispatchCreate

派遣作成時の入力

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**completed_log_id** | **string** | 派遣する完成ログのID | [default to undefined]
**dispatcher_id** | **string** | 派遣するキャラクターのID | [default to undefined]
**objective_type** | [**DispatchObjectiveType**](DispatchObjectiveType.md) | 派遣目的 | [default to undefined]
**objective_detail** | **string** | 具体的な目的の説明 | [default to undefined]
**initial_location** | **string** | 初期スポーン地点 | [default to undefined]
**dispatch_duration_days** | **number** | 派遣期間（日） | [default to undefined]

## Example

```typescript
import { DispatchCreate } from './api';

const instance: DispatchCreate = {
    completed_log_id,
    dispatcher_id,
    objective_type,
    objective_detail,
    initial_location,
    dispatch_duration_days,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
