# QuestsApi

All URIs are relative to _http://localhost_

| Method                                                                                                                                    | HTTP request                                                    | Description           |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------- |
| [**acceptQuestApiV1QuestsCharacterIdQuestsQuestIdAcceptPost**](#acceptquestapiv1questscharacteridquestsquestidacceptpost)                 | **POST** /api/v1/quests/{character_id}/quests/{quest_id}/accept | Accept Quest          |
| [**createQuestApiV1QuestsCharacterIdCreatePost**](#createquestapiv1questscharacteridcreatepost)                                           | **POST** /api/v1/quests/{character_id}/create                   | Create Quest          |
| [**getCharacterQuestsApiV1QuestsCharacterIdQuestsGet**](#getcharacterquestsapiv1questscharacteridquestsget)                               | **GET** /api/v1/quests/{character_id}/quests                    | Get Character Quests  |
| [**getQuestProposalsApiV1QuestsCharacterIdProposalsGet**](#getquestproposalsapiv1questscharacteridproposalsget)                           | **GET** /api/v1/quests/{character_id}/proposals                 | Get Quest Proposals   |
| [**inferImplicitQuestApiV1QuestsCharacterIdQuestsInferPost**](#inferimplicitquestapiv1questscharacteridquestsinferpost)                   | **POST** /api/v1/quests/{character_id}/quests/infer             | Infer Implicit Quest  |
| [**updateQuestProgressApiV1QuestsCharacterIdQuestsQuestIdUpdatePost**](#updatequestprogressapiv1questscharacteridquestsquestidupdatepost) | **POST** /api/v1/quests/{character_id}/quests/{quest_id}/update | Update Quest Progress |

# **acceptQuestApiV1QuestsCharacterIdQuestsQuestIdAcceptPost**

> Quest acceptQuestApiV1QuestsCharacterIdQuestsQuestIdAcceptPost()

提案されたクエストを受諾する Args: character_id: キャラクターID quest_id: クエストID Returns: 更新されたクエスト

### Example

```typescript
import { QuestsApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new QuestsApi(configuration)

let characterId: string // (default to undefined)
let questId: string // (default to undefined)
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.acceptQuestApiV1QuestsCharacterIdQuestsQuestIdAcceptPost(
    characterId,
    questId,
    authToken
  )
```

### Parameters

| Name            | Type         | Description | Notes                            |
| --------------- | ------------ | ----------- | -------------------------------- |
| **characterId** | [**string**] |             | defaults to undefined            |
| **questId**     | [**string**] |             | defaults to undefined            |
| **authToken**   | [**string**] |             | (optional) defaults to undefined |

### Return type

**Quest**

### Authorization

[OAuth2PasswordBearer](../README.md#OAuth2PasswordBearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

### HTTP response details

| Status code | Description         | Response headers |
| ----------- | ------------------- | ---------------- |
| **200**     | Successful Response | -                |
| **422**     | Validation Error    | -                |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **createQuestApiV1QuestsCharacterIdCreatePost**

> Quest createQuestApiV1QuestsCharacterIdCreatePost()

新しいクエストを作成する Args: character_id: キャラクターID title: クエストタイトル description: クエストの説明 origin: クエストの発生源 session_id: セッションID（オプション） Returns: 作成されたクエスト

### Example

```typescript
import { QuestsApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new QuestsApi(configuration)

let characterId: string // (default to undefined)
let title: string // (default to undefined)
let description: string // (default to undefined)
let origin: QuestOrigin // (optional) (default to undefined)
let sessionId: string // (optional) (default to undefined)
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.createQuestApiV1QuestsCharacterIdCreatePost(
    characterId,
    title,
    description,
    origin,
    sessionId,
    authToken
  )
```

### Parameters

| Name            | Type            | Description | Notes                            |
| --------------- | --------------- | ----------- | -------------------------------- |
| **characterId** | [**string**]    |             | defaults to undefined            |
| **title**       | [**string**]    |             | defaults to undefined            |
| **description** | [**string**]    |             | defaults to undefined            |
| **origin**      | **QuestOrigin** |             | (optional) defaults to undefined |
| **sessionId**   | [**string**]    |             | (optional) defaults to undefined |
| **authToken**   | [**string**]    |             | (optional) defaults to undefined |

### Return type

**Quest**

### Authorization

[OAuth2PasswordBearer](../README.md#OAuth2PasswordBearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

### HTTP response details

| Status code | Description         | Response headers |
| ----------- | ------------------- | ---------------- |
| **200**     | Successful Response | -                |
| **422**     | Validation Error    | -                |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **getCharacterQuestsApiV1QuestsCharacterIdQuestsGet**

> Array<Quest> getCharacterQuestsApiV1QuestsCharacterIdQuestsGet()

キャラクターのクエストを取得する Args: character_id: キャラクターID status: フィルタリングするステータス（オプション） limit: 取得数制限 offset: オフセット Returns: クエストのリスト

### Example

```typescript
import { QuestsApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new QuestsApi(configuration)

let characterId: string // (default to undefined)
let status: QuestStatus // (optional) (default to undefined)
let limit: number // (optional) (default to 20)
let offset: number // (optional) (default to 0)
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.getCharacterQuestsApiV1QuestsCharacterIdQuestsGet(
    characterId,
    status,
    limit,
    offset,
    authToken
  )
```

### Parameters

| Name            | Type            | Description | Notes                            |
| --------------- | --------------- | ----------- | -------------------------------- |
| **characterId** | [**string**]    |             | defaults to undefined            |
| **status**      | **QuestStatus** |             | (optional) defaults to undefined |
| **limit**       | [**number**]    |             | (optional) defaults to 20        |
| **offset**      | [**number**]    |             | (optional) defaults to 0         |
| **authToken**   | [**string**]    |             | (optional) defaults to undefined |

### Return type

**Array<Quest>**

### Authorization

[OAuth2PasswordBearer](../README.md#OAuth2PasswordBearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

### HTTP response details

| Status code | Description         | Response headers |
| ----------- | ------------------- | ---------------- |
| **200**     | Successful Response | -                |
| **422**     | Validation Error    | -                |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **getQuestProposalsApiV1QuestsCharacterIdProposalsGet**

> Array<QuestProposal> getQuestProposalsApiV1QuestsCharacterIdProposalsGet()

最近の行動を分析してクエストを提案する Args: character_id: キャラクターID session_id: 現在のセッションID Returns: 提案されたクエストのリスト

### Example

```typescript
import { QuestsApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new QuestsApi(configuration)

let characterId: string // (default to undefined)
let sessionId: string // (default to undefined)
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.getQuestProposalsApiV1QuestsCharacterIdProposalsGet(
    characterId,
    sessionId,
    authToken
  )
```

### Parameters

| Name            | Type         | Description | Notes                            |
| --------------- | ------------ | ----------- | -------------------------------- |
| **characterId** | [**string**] |             | defaults to undefined            |
| **sessionId**   | [**string**] |             | defaults to undefined            |
| **authToken**   | [**string**] |             | (optional) defaults to undefined |

### Return type

**Array<QuestProposal>**

### Authorization

[OAuth2PasswordBearer](../README.md#OAuth2PasswordBearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

### HTTP response details

| Status code | Description         | Response headers |
| ----------- | ------------------- | ---------------- |
| **200**     | Successful Response | -                |
| **422**     | Validation Error    | -                |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **inferImplicitQuestApiV1QuestsCharacterIdQuestsInferPost**

> Quest inferImplicitQuestApiV1QuestsCharacterIdQuestsInferPost()

プレイヤーの行動から暗黙的なクエストを推測する Args: character_id: キャラクターID session_id: セッションID Returns: 推測されたクエスト（作成された場合）

### Example

```typescript
import { QuestsApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new QuestsApi(configuration)

let characterId: string // (default to undefined)
let sessionId: string // (default to undefined)
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.inferImplicitQuestApiV1QuestsCharacterIdQuestsInferPost(
    characterId,
    sessionId,
    authToken
  )
```

### Parameters

| Name            | Type         | Description | Notes                            |
| --------------- | ------------ | ----------- | -------------------------------- |
| **characterId** | [**string**] |             | defaults to undefined            |
| **sessionId**   | [**string**] |             | defaults to undefined            |
| **authToken**   | [**string**] |             | (optional) defaults to undefined |

### Return type

**Quest**

### Authorization

[OAuth2PasswordBearer](../README.md#OAuth2PasswordBearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

### HTTP response details

| Status code | Description         | Response headers |
| ----------- | ------------------- | ---------------- |
| **200**     | Successful Response | -                |
| **422**     | Validation Error    | -                |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **updateQuestProgressApiV1QuestsCharacterIdQuestsQuestIdUpdatePost**

> Quest updateQuestProgressApiV1QuestsCharacterIdQuestsQuestIdUpdatePost()

クエストの進行状況を更新する Args: character_id: キャラクターID quest_id: クエストID Returns: 更新されたクエスト

### Example

```typescript
import { QuestsApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new QuestsApi(configuration)

let characterId: string // (default to undefined)
let questId: string // (default to undefined)
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.updateQuestProgressApiV1QuestsCharacterIdQuestsQuestIdUpdatePost(
    characterId,
    questId,
    authToken
  )
```

### Parameters

| Name            | Type         | Description | Notes                            |
| --------------- | ------------ | ----------- | -------------------------------- |
| **characterId** | [**string**] |             | defaults to undefined            |
| **questId**     | [**string**] |             | defaults to undefined            |
| **authToken**   | [**string**] |             | (optional) defaults to undefined |

### Return type

**Quest**

### Authorization

[OAuth2PasswordBearer](../README.md#OAuth2PasswordBearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

### HTTP response details

| Status code | Description         | Response headers |
| ----------- | ------------------- | ---------------- |
| **200**     | Successful Response | -                |
| **422**     | Validation Error    | -                |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)
