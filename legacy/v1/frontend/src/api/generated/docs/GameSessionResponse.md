# GameSessionResponse

ゲームセッションレスポンス

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **string** |  | [default to undefined]
**character_id** | **string** |  | [default to undefined]
**session_number** | **number** | セッション番号 | [default to undefined]
**is_active** | **boolean** |  | [default to undefined]
**session_status** | **string** | セッションステータス | [default to undefined]
**current_scene** | **string** |  | [optional] [default to undefined]
**turn_count** | **number** | ターン数 | [optional] [default to 0]
**word_count** | **number** | 総単語数 | [optional] [default to 0]
**play_duration_minutes** | **number** | プレイ時間（分） | [optional] [default to 0]
**is_first_session** | **boolean** | 初回セッションかどうか | [optional] [default to false]
**created_at** | **Date** |  | [default to undefined]
**updated_at** | **Date** |  | [default to undefined]
**ended_at** | **Date** |  | [optional] [default to undefined]

## Example

```typescript
import { GameSessionResponse } from './api';

const instance: GameSessionResponse = {
    id,
    character_id,
    session_number,
    is_active,
    session_status,
    current_scene,
    turn_count,
    word_count,
    play_duration_minutes,
    is_first_session,
    created_at,
    updated_at,
    ended_at,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
