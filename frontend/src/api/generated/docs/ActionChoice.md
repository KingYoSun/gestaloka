# ActionChoice

行動選択肢

## Properties

| Name            | Type       | Description                                   | Notes                             |
| --------------- | ---------- | --------------------------------------------- | --------------------------------- |
| **text**        | **string** | 表示する選択肢のテキスト                      | [default to undefined]            |
| **actionType**  | **string** | 行動のタイプ（move, investigate, interact等） | [default to undefined]            |
| **description** | **string** |                                               | [optional] [default to undefined] |
| **metadata**    | **object** |                                               | [optional] [default to undefined] |

## Example

```typescript
import { ActionChoice } from './api'

const instance: ActionChoice = {
  text,
  actionType,
  description,
  metadata,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
