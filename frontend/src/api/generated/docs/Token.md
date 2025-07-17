# Token

トークンスキーマ

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**access_token** | **string** |  | [default to undefined]
**token_type** | **string** |  | [optional] [default to 'bearer']
**user** | [**User**](User.md) |  | [default to undefined]

## Example

```typescript
import { Token } from './api';

const instance: Token = {
    access_token,
    token_type,
    user,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
