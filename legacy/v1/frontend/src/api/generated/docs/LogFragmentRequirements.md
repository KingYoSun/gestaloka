# LogFragmentRequirements

ログの欠片に関する設定

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**min_fragments_for_completion** | **number** | ログ完成に必要な最小欠片数 | [optional] [default to 3]
**max_fragments_for_completion** | **number** | ログ完成に必要な最大欠片数 | [optional] [default to 10]
**fragment_generation_cooldown_hours** | **number** | 欠片生成のクールダウン時間（時間） | [optional] [default to 24]
**max_active_contracts** | **number** | 同時に持てる最大契約数 | [optional] [default to 5]

## Example

```typescript
import { LogFragmentRequirements } from './api';

const instance: LogFragmentRequirements = {
    min_fragments_for_completion,
    max_fragments_for_completion,
    fragment_generation_cooldown_hours,
    max_active_contracts,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
