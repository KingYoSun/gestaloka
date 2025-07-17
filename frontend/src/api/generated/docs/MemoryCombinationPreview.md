# MemoryCombinationPreview

記憶組み合わせのプレビュー

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**fragment_ids** | **Array&lt;string&gt;** | 組み合わせる記憶フラグメントのIDリスト | [default to undefined]
**possible_types** | [**Array&lt;MemoryInheritanceType&gt;**](MemoryInheritanceType.md) | 可能な継承タイプのリスト | [default to undefined]
**previews** | **{ [key: string]: object; }** | 各継承タイプのプレビュー情報 | [default to undefined]
**sp_costs** | **{ [key: string]: number; }** | 各継承タイプのSP消費量 | [default to undefined]
**combo_bonus** | **string** |  | [optional] [default to undefined]

## Example

```typescript
import { MemoryCombinationPreview } from './api';

const instance: MemoryCombinationPreview = {
    fragment_ids,
    possible_types,
    previews,
    sp_costs,
    combo_bonus,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
