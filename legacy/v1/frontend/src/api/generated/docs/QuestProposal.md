# QuestProposal

GM AIからのクエスト提案

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**title** | **string** | 提案するクエストのタイトル（最大100文字） | [default to undefined]
**description** | **string** | クエストの説明（最大2500文字） | [default to undefined]
**reasoning** | **string** | なぜこのクエストを提案するか | [default to undefined]
**difficulty_estimate** | **number** | 推定難易度（0-1） | [default to undefined]
**relevance_score** | **number** | 現在の文脈との関連性スコア | [default to undefined]
**suggested_rewards** | **Array&lt;string&gt;** | 完了時の推奨報酬 | [optional] [default to undefined]

## Example

```typescript
import { QuestProposal } from './api';

const instance: QuestProposal = {
    title,
    description,
    reasoning,
    difficulty_estimate,
    relevance_score,
    suggested_rewards,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
