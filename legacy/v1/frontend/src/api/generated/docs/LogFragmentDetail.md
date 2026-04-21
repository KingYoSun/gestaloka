# LogFragmentDetail

ログフラグメントの詳細スキーマ

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**keyword** | **string** | メインキーワード | [default to undefined]
**keywords** | **Array&lt;string&gt;** | 関連キーワードリスト | [default to undefined]
**emotional_valence** | [**EmotionalValence**](EmotionalValence.md) |  | [default to undefined]
**rarity** | [**LogFragmentRarity**](LogFragmentRarity.md) | レアリティ | [default to undefined]
**backstory** | **string** | フラグメントの背景ストーリー | [default to undefined]
**id** | **string** |  | [default to undefined]
**character_id** | **string** |  | [default to undefined]
**action_description** | **string** | 行動の詳細な記述 | [default to undefined]
**discovered_at** | **string** |  | [optional] [default to undefined]
**source_action** | **string** |  | [optional] [default to undefined]
**importance_score** | **number** | 重要度スコア（0.0-1.0） | [default to undefined]
**context_data** | **object** | 文脈情報 | [default to undefined]
**created_at** | **Date** |  | [default to undefined]

## Example

```typescript
import { LogFragmentDetail } from './api';

const instance: LogFragmentDetail = {
    keyword,
    keywords,
    emotional_valence,
    rarity,
    backstory,
    id,
    character_id,
    action_description,
    discovered_at,
    source_action,
    importance_score,
    context_data,
    created_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
