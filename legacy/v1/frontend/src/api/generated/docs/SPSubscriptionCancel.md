# SPSubscriptionCancel

サブスクリプションキャンセルスキーマ

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**reason** | **string** |  | [optional] [default to undefined]
**immediate** | **boolean** | 即時キャンセル（Trueの場合、期限まで待たずに即座にキャンセル） | [optional] [default to false]

## Example

```typescript
import { SPSubscriptionCancel } from './api';

const instance: SPSubscriptionCancel = {
    reason,
    immediate,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
