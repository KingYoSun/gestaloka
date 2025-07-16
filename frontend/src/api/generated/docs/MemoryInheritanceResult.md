# MemoryInheritanceResult

記憶継承の結果

## Properties

| Name                | Type                                                  | Description                          | Notes                  |
| ------------------- | ----------------------------------------------------- | ------------------------------------ | ---------------------- |
| **success**         | **boolean**                                           | 継承が成功したかどうか               | [default to undefined] |
| **inheritanceType** | [**MemoryInheritanceType**](MemoryInheritanceType.md) | 実行された継承タイプ                 | [default to undefined] |
| **result**          | **object**                                            | 継承結果の詳細                       | [default to undefined] |
| **spConsumed**      | **number**                                            | 消費されたSP                         | [default to undefined] |
| **fragmentsUsed**   | **Array&lt;string&gt;**                               | 使用された記憶フラグメントのIDリスト | [default to undefined] |

## Example

```typescript
import { MemoryInheritanceResult } from './api'

const instance: MemoryInheritanceResult = {
  success,
  inheritanceType,
  result,
  spConsumed,
  fragmentsUsed,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
