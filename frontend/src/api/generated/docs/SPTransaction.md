# SPTransaction

SP取引履歴を記録するモデル  全てのSPの増減を記録し、監査やデバッグ、不正検出に使用します。

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **string** | 取引ID | [optional] [default to undefined]
**player_sp_id** | **string** | プレイヤーSP残高ID | [default to undefined]
**user_id** | **string** | ユーザーID（検索高速化のため冗長に保持） | [default to undefined]
**transaction_type** | [**SPTransactionType**](SPTransactionType.md) | 取引の種類 | [default to undefined]
**amount** | **number** | SP増減量（正の値は獲得、負の値は消費） | [default to undefined]
**balance_before** | **number** | 取引前のSP残高 | [default to undefined]
**balance_after** | **number** | 取引後のSP残高 | [default to undefined]
**description** | **string** | 取引の説明 | [default to undefined]
**transaction_metadata** | **object** | 取引に関する追加情報（購入パッケージ、ログ派遣詳細など） | [optional] [default to undefined]
**related_entity_type** | **string** |  | [optional] [default to undefined]
**related_entity_id** | **string** |  | [optional] [default to undefined]
**purchase_package** | [**SPPurchasePackage**](SPPurchasePackage.md) |  | [optional] [default to undefined]
**purchase_amount** | **number** |  | [optional] [default to undefined]
**payment_method** | **string** |  | [optional] [default to undefined]
**payment_transaction_id** | **string** |  | [optional] [default to undefined]
**created_at** | **Date** | 取引日時 | [optional] [default to undefined]

## Example

```typescript
import { SPTransaction } from './api';

const instance: SPTransaction = {
    id,
    player_sp_id,
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    description,
    transaction_metadata,
    related_entity_type,
    related_entity_id,
    purchase_package,
    purchase_amount,
    payment_method,
    payment_transaction_id,
    created_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
