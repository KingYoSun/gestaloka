# LogFragmentStatistics

ログフラグメントの統計情報

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**total_fragments** | **number** | 総フラグメント数 | [default to undefined]
**by_rarity** | **{ [key: string]: number; }** | レアリティ別の数 | [default to undefined]
**unique_keywords** | **number** | ユニークキーワード数 | [default to undefined]

## Example

```typescript
import { LogFragmentStatistics } from './api';

const instance: LogFragmentStatistics = {
    total_fragments,
    by_rarity,
    unique_keywords,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
