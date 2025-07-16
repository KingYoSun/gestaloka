# SPTransactionRead

SP取引読み取り用スキーマ

## Properties

| Name                    | Type                                          | Description | Notes                  |
| ----------------------- | --------------------------------------------- | ----------- | ---------------------- |
| **transactionType**     | [**SPTransactionType**](SPTransactionType.md) |             | [default to undefined] |
| **amount**              | **number**                                    |             | [default to undefined] |
| **description**         | **string**                                    |             | [default to undefined] |
| **id**                  | **string**                                    |             | [default to undefined] |
| **playerSpId**          | **string**                                    |             | [default to undefined] |
| **userId**              | **string**                                    |             | [default to undefined] |
| **balanceBefore**       | **number**                                    |             | [default to undefined] |
| **balanceAfter**        | **number**                                    |             | [default to undefined] |
| **transactionMetadata** | **object**                                    |             | [default to undefined] |
| **relatedEntityType**   | **string**                                    |             | [default to undefined] |
| **relatedEntityId**     | **string**                                    |             | [default to undefined] |
| **purchasePackage**     | [**SPPurchasePackage**](SPPurchasePackage.md) |             | [default to undefined] |
| **purchaseAmount**      | **number**                                    |             | [default to undefined] |
| **paymentMethod**       | **string**                                    |             | [default to undefined] |
| **createdAt**           | **string**                                    |             | [default to undefined] |

## Example

```typescript
import { SPTransactionRead } from './api'

const instance: SPTransactionRead = {
  transactionType,
  amount,
  description,
  id,
  playerSpId,
  userId,
  balanceBefore,
  balanceAfter,
  transactionMetadata,
  relatedEntityType,
  relatedEntityId,
  purchasePackage,
  purchaseAmount,
  paymentMethod,
  createdAt,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
