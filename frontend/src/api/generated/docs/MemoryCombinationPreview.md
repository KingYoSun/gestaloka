# MemoryCombinationPreview

記憶組み合わせのプレビュー

## Properties

| Name              | Type                                                               | Description                            | Notes                             |
| ----------------- | ------------------------------------------------------------------ | -------------------------------------- | --------------------------------- |
| **fragmentIds**   | **Array&lt;string&gt;**                                            | 組み合わせる記憶フラグメントのIDリスト | [default to undefined]            |
| **possibleTypes** | [**Array&lt;MemoryInheritanceType&gt;**](MemoryInheritanceType.md) | 可能な継承タイプのリスト               | [default to undefined]            |
| **previews**      | **{ [key: string]: object; }**                                     | 各継承タイプのプレビュー情報           | [default to undefined]            |
| **spCosts**       | **{ [key: string]: number; }**                                     | 各継承タイプのSP消費量                 | [default to undefined]            |
| **comboBonus**    | **string**                                                         |                                        | [optional] [default to undefined] |

## Example

```typescript
import { MemoryCombinationPreview } from './api'

const instance: MemoryCombinationPreview = {
  fragmentIds,
  possibleTypes,
  previews,
  spCosts,
  comboBonus,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
