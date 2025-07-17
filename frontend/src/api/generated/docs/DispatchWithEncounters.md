# DispatchWithEncounters

遭遇記録を含む派遣情報

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**completed_log_id** | **string** | 派遣する完成ログのID | [default to undefined]
**dispatcher_id** | **string** | 派遣するキャラクターのID | [default to undefined]
**objective_type** | [**DispatchObjectiveType**](DispatchObjectiveType.md) | 派遣目的 | [default to undefined]
**objective_detail** | **string** | 具体的な目的の説明 | [default to undefined]
**initial_location** | **string** | 初期スポーン地点 | [default to undefined]
**dispatch_duration_days** | **number** | 派遣期間（日） | [default to undefined]
**id** | **string** |  | [default to undefined]
**sp_cost** | **number** | 消費SP | [default to undefined]
**status** | [**DispatchStatus**](DispatchStatus.md) |  | [default to undefined]
**travel_log** | **Array&lt;object&gt;** | 時系列の活動記録 | [default to undefined]
**collected_items** | **Array&lt;object&gt;** | 収集したアイテム | [default to undefined]
**discovered_locations** | **Array&lt;string&gt;** | 発見した場所 | [default to undefined]
**sp_refund_amount** | **number** | SP還元量 | [default to undefined]
**achievement_score** | **number** | 達成度スコア（0.0-1.0） | [default to undefined]
**created_at** | **Date** |  | [default to undefined]
**dispatched_at** | **Date** |  | [default to undefined]
**expected_return_at** | **Date** |  | [default to undefined]
**actual_return_at** | **Date** |  | [default to undefined]
**encounters** | [**Array&lt;DispatchEncounterRead&gt;**](DispatchEncounterRead.md) | 遭遇記録一覧 | [default to undefined]

## Example

```typescript
import { DispatchWithEncounters } from './api';

const instance: DispatchWithEncounters = {
    completed_log_id,
    dispatcher_id,
    objective_type,
    objective_detail,
    initial_location,
    dispatch_duration_days,
    id,
    sp_cost,
    status,
    travel_log,
    collected_items,
    discovered_locations,
    sp_refund_amount,
    achievement_score,
    created_at,
    dispatched_at,
    expected_return_at,
    actual_return_at,
    encounters,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
