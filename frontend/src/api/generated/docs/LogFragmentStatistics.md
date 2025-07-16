# LogFragmentStatistics

ログフラグメントの統計情報

## Properties

| Name               | Type                           | Description          | Notes                  |
| ------------------ | ------------------------------ | -------------------- | ---------------------- |
| **totalFragments** | **number**                     | 総フラグメント数     | [default to undefined] |
| **byRarity**       | **{ [key: string]: number; }** | レアリティ別の数     | [default to undefined] |
| **uniqueKeywords** | **number**                     | ユニークキーワード数 | [default to undefined] |

## Example

```typescript
import { LogFragmentStatistics } from './api'

const instance: LogFragmentStatistics = {
  totalFragments,
  byRarity,
  uniqueKeywords,
}
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
