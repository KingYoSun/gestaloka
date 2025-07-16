# LocationEvent

場所で発生したイベント

## Properties

| Name            | Type       | Description      | Notes                             |
| --------------- | ---------- | ---------------- | --------------------------------- |
| **type**        | **string** | イベントタイプ   | [default to undefined]            |
| **title**       | **string** | イベントタイトル | [default to undefined]            |
| **description** | **string** | イベントの詳細   | [default to undefined]            |
| **effects**     | **object** |                  | [optional] [default to undefined] |

## Example

```typescript
import { LocationEvent } from './api'

const instance: LocationEvent = {
  type,
  title,
  description,
  effects,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
