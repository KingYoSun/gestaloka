# LogFragmentListResponse

ログフラグメント一覧のレスポンス

## Properties

| Name           | Type                                                       | Description | Notes                  |
| -------------- | ---------------------------------------------------------- | ----------- | ---------------------- |
| **fragments**  | [**Array&lt;LogFragmentDetail&gt;**](LogFragmentDetail.md) |             | [default to undefined] |
| **total**      | **number**                                                 | 総数        | [default to undefined] |
| **statistics** | [**LogFragmentStatistics**](LogFragmentStatistics.md)      | 統計情報    | [default to undefined] |

## Example

```typescript
import { LogFragmentListResponse } from './api'

const instance: LogFragmentListResponse = {
  fragments,
  total,
  statistics,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
