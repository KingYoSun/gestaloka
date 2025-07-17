# User

ユーザースキーマ（レスポンス用）

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**username** | **string** | ユーザー名 | [default to undefined]
**email** | **string** | メールアドレス | [default to undefined]
**id** | **string** |  | [default to undefined]
**is_active** | **boolean** |  | [optional] [default to true]
**is_verified** | **boolean** |  | [optional] [default to false]
**roles** | **Array&lt;string&gt;** | ユーザーのロール一覧 | [optional] [default to undefined]
**created_at** | **Date** |  | [default to undefined]
**updated_at** | **Date** |  | [default to undefined]

## Example

```typescript
import { User } from './api';

const instance: User = {
    username,
    email,
    id,
    is_active,
    is_verified,
    roles,
    created_at,
    updated_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
