# LogFragmentCreate

ログフラグメント作成スキーマ

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**action_description** | **string** | 行動の詳細な記述 | [default to undefined]
**keywords** | **Array&lt;string&gt;** | キーワード | [optional] [default to undefined]
**emotional_valence** | [**EmotionalValence**](EmotionalValence.md) | 感情価 | [optional] [default to undefined]
**rarity** | [**LogFragmentRarity**](LogFragmentRarity.md) | レアリティ | [optional] [default to undefined]
**importance_score** | **number** | 重要度スコア | [optional] [default to 0.0]
**context_data** | **object** | 行動時の文脈情報 | [optional] [default to undefined]
**character_id** | **string** |  | [default to undefined]
**session_id** | **string** |  | [default to undefined]

## Example

```typescript
import { LogFragmentCreate } from './api';

const instance: LogFragmentCreate = {
    action_description,
    keywords,
    emotional_valence,
    rarity,
    importance_score,
    context_data,
    character_id,
    session_id,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
