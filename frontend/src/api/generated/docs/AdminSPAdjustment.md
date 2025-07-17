# AdminSPAdjustment

SP調整リクエスト

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**user_id** | **number** | 対象ユーザーID | [default to undefined]
**amount** | **number** | 調整量（正の値で付与、負の値で減算） | [default to undefined]
**reason** | **string** |  | [optional] [default to undefined]

## Example

```typescript
import { AdminSPAdjustment } from './api';

const instance: AdminSPAdjustment = {
    user_id,
    amount,
    reason,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
