# ActionRequest

プレイヤーの行動リクエスト

## Properties

| Name        | Type       | Description                      | Notes                             |
| ----------- | ---------- | -------------------------------- | --------------------------------- |
| **text**    | **string** | プレイヤーが選択した行動テキスト | [default to undefined]            |
| **context** | **object** |                                  | [optional] [default to undefined] |

## Example

```typescript
import { ActionRequest } from './api'

const instance: ActionRequest = {
  text,
  context,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
