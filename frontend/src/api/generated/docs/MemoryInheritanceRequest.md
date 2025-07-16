# MemoryInheritanceRequest

記憶継承リクエスト

## Properties

| Name                | Type                                                  | Description                                       | Notes                  |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------- | ---------------------- |
| **fragmentIds**     | **Array&lt;string&gt;**                               | 組み合わせる記憶フラグメントのIDリスト（最低2つ） | [default to undefined] |
| **inheritanceType** | [**MemoryInheritanceType**](MemoryInheritanceType.md) | 継承タイプ                                        | [default to undefined] |

## Example

```typescript
import { MemoryInheritanceRequest } from './api'

const instance: MemoryInheritanceRequest = {
  fragmentIds,
  inheritanceType,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
