# SPTransaction

SP取引履歴を記録するモデル 全てのSPの増減を記録し、監査やデバッグ、不正検出に使用します。

## Properties

| Name                     | Type                                          | Description                                              | Notes                             |
| ------------------------ | --------------------------------------------- | -------------------------------------------------------- | --------------------------------- |
| **id**                   | **string**                                    | 取引ID                                                   | [optional] [default to undefined] |
| **playerSpId**           | **string**                                    | プレイヤーSP残高ID                                       | [default to undefined]            |
| **userId**               | **string**                                    | ユーザーID（検索高速化のため冗長に保持）                 | [default to undefined]            |
| **transactionType**      | [**SPTransactionType**](SPTransactionType.md) | 取引の種類                                               | [default to undefined]            |
| **amount**               | **number**                                    | SP増減量（正の値は獲得、負の値は消費）                   | [default to undefined]            |
| **balanceBefore**        | **number**                                    | 取引前のSP残高                                           | [default to undefined]            |
| **balanceAfter**         | **number**                                    | 取引後のSP残高                                           | [default to undefined]            |
| **description**          | **string**                                    | 取引の説明                                               | [default to undefined]            |
| **transactionMetadata**  | **object**                                    | 取引に関する追加情報（購入パッケージ、ログ派遣詳細など） | [optional] [default to undefined] |
| **relatedEntityType**    | **string**                                    |                                                          | [optional] [default to undefined] |
| **relatedEntityId**      | **string**                                    |                                                          | [optional] [default to undefined] |
| **purchasePackage**      | [**SPPurchasePackage**](SPPurchasePackage.md) |                                                          | [optional] [default to undefined] |
| **purchaseAmount**       | **number**                                    |                                                          | [optional] [default to undefined] |
| **paymentMethod**        | **string**                                    |                                                          | [optional] [default to undefined] |
| **paymentTransactionId** | **string**                                    |                                                          | [optional] [default to undefined] |
| **createdAt**            | **string**                                    | 取引日時                                                 | [optional] [default to undefined] |

## Example

```typescript
import { SPTransaction } from './api'

const instance: SPTransaction = {
  id,
  playerSpId,
  userId,
  transactionType,
  amount,
  balanceBefore,
  balanceAfter,
  description,
  transactionMetadata,
  relatedEntityType,
  relatedEntityId,
  purchasePackage,
  purchaseAmount,
  paymentMethod,
  paymentTransactionId,
  createdAt,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
