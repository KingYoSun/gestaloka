# Token

トークンスキーマ

## Properties

| Name            | Type                | Description | Notes                            |
| --------------- | ------------------- | ----------- | -------------------------------- |
| **accessToken** | **string**          |             | [default to undefined]           |
| **tokenType**   | **string**          |             | [optional] [default to 'bearer'] |
| **user**        | [**User**](User.md) |             | [default to undefined]           |

## Example

```typescript
import { Token } from './api'

const instance: Token = {
  accessToken,
  tokenType,
  user,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
