# NarrativeResponse

物語生成のレスポンス

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**narrative** | **string** | 生成された物語テキスト | [default to undefined]
**location_changed** | **boolean** | 場所が変更されたか | [optional] [default to false]
**new_location_id** | **string** |  | [optional] [default to undefined]
**new_location_name** | **string** |  | [optional] [default to undefined]
**sp_consumed** | **number** | 消費されたSP | [optional] [default to 0]
**action_choices** | [**Array&lt;ActionChoice&gt;**](ActionChoice.md) | 次の行動選択肢 | [default to undefined]
**events** | [**Array&lt;LocationEvent&gt;**](LocationEvent.md) |  | [optional] [default to undefined]

## Example

```typescript
import { NarrativeResponse } from './api';

const instance: NarrativeResponse = {
    narrative,
    location_changed,
    new_location_id,
    new_location_name,
    sp_consumed,
    action_choices,
    events,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
