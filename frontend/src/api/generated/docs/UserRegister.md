# UserRegister

ユーザー登録スキーマ

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**username** | **string** | ユーザー名 | [default to undefined]
**email** | **string** | メールアドレス | [default to undefined]
**password** | **string** | パスワード | [default to undefined]
**confirm_password** | **string** | パスワード確認 | [default to undefined]

## Example

```typescript
import { UserRegister } from './api';

const instance: UserRegister = {
    username,
    email,
    password,
    confirm_password,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
