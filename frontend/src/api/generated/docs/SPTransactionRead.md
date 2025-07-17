# SPTransactionRead

SP取引読み取り用スキーマ

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**transaction_type** | [**SPTransactionType**](SPTransactionType.md) |  | [default to undefined]
**amount** | **number** |  | [default to undefined]
**description** | **string** |  | [default to undefined]
**id** | **string** |  | [default to undefined]
**player_sp_id** | **string** |  | [default to undefined]
**user_id** | **string** |  | [default to undefined]
**balance_before** | **number** |  | [default to undefined]
**balance_after** | **number** |  | [default to undefined]
**transaction_metadata** | **object** |  | [default to undefined]
**related_entity_type** | **string** |  | [default to undefined]
**related_entity_id** | **string** |  | [default to undefined]
**purchase_package** | [**SPPurchasePackage**](SPPurchasePackage.md) |  | [default to undefined]
**purchase_amount** | **number** |  | [default to undefined]
**payment_method** | **string** |  | [default to undefined]
**created_at** | **Date** |  | [default to undefined]

## Example

```typescript
import { SPTransactionRead } from './api';

const instance: SPTransactionRead = {
    transaction_type,
    amount,
    description,
    id,
    player_sp_id,
    user_id,
    balance_before,
    balance_after,
    transaction_metadata,
    related_entity_type,
    related_entity_id,
    purchase_package,
    purchase_amount,
    payment_method,
    created_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
