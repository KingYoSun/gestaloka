# User

ユーザースキーマ（レスポンス用）

## Properties

| Name           | Type                    | Description          | Notes                             |
| -------------- | ----------------------- | -------------------- | --------------------------------- |
| **username**   | **string**              | ユーザー名           | [default to undefined]            |
| **email**      | **string**              | メールアドレス       | [default to undefined]            |
| **id**         | **string**              |                      | [default to undefined]            |
| **isActive**   | **boolean**             |                      | [optional] [default to true]      |
| **isVerified** | **boolean**             |                      | [optional] [default to false]     |
| **roles**      | **Array&lt;string&gt;** | ユーザーのロール一覧 | [optional] [default to undefined] |
| **createdAt**  | **string**              |                      | [default to undefined]            |
| **updatedAt**  | **string**              |                      | [default to undefined]            |

## Example

```typescript
import { User } from './api'

const instance: User = {
  username,
  email,
  id,
  isActive,
  isVerified,
  roles,
  createdAt,
  updatedAt,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
