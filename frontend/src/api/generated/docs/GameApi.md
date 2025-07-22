# GameApi

All URIs are relative to *http://localhost*

|Method | HTTP request | Description|
|------------- | ------------- | -------------|
|[**continueSessionApiV1GameSessionsSessionIdContinuePost**](#continuesessionapiv1gamesessionssessionidcontinuepost) | **POST** /api/v1/game/sessions/{session_id}/continue | Continue Session|
|[**createSessionApiV1GameSessionsPost**](#createsessionapiv1gamesessionspost) | **POST** /api/v1/game/sessions | Create Session|
|[**endSessionApiV1GameSessionsSessionIdEndPost**](#endsessionapiv1gamesessionssessionidendpost) | **POST** /api/v1/game/sessions/{session_id}/end | End Session|
|[**getActiveSessionApiV1GameSessionsActiveGet**](#getactivesessionapiv1gamesessionsactiveget) | **GET** /api/v1/game/sessions/active | Get Active Session|
|[**getSessionApiV1GameSessionsSessionIdGet**](#getsessionapiv1gamesessionssessionidget) | **GET** /api/v1/game/sessions/{session_id} | Get Session|
|[**getSessionHistoryApiV1GameSessionsHistoryGet**](#getsessionhistoryapiv1gamesessionshistoryget) | **GET** /api/v1/game/sessions/history | Get Session History|

# **continueSessionApiV1GameSessionsSessionIdContinuePost**
> GameSessionResponse continueSessionApiV1GameSessionsSessionIdContinuePost(sessionContinueRequest)

既存セッションを継続  - **session_id**: 継続するセッションのID

### Example

```typescript
import {
    GameApi,
    Configuration,
    SessionContinueRequest
} from './api';

const configuration = new Configuration();
const apiInstance = new GameApi(configuration);

let sessionId: string; // (default to undefined)
let sessionContinueRequest: SessionContinueRequest; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.continueSessionApiV1GameSessionsSessionIdContinuePost(
    sessionId,
    sessionContinueRequest,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **sessionContinueRequest** | **SessionContinueRequest**|  | |
| **sessionId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**GameSessionResponse**

### Authorization

[OAuth2PasswordBearer](../README.md#OAuth2PasswordBearer)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Successful Response |  -  |
|**422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **createSessionApiV1GameSessionsPost**
> GameSessionResponse createSessionApiV1GameSessionsPost(gameSessionCreate)

新規ゲームセッションを作成  - **character_id**: セッションを開始するキャラクターのID - **current_scene**: 開始シーン（省略時はtown_square）

### Example

```typescript
import {
    GameApi,
    Configuration,
    GameSessionCreate
} from './api';

const configuration = new Configuration();
const apiInstance = new GameApi(configuration);

let characterId: string; // (default to undefined)
let gameSessionCreate: GameSessionCreate; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.createSessionApiV1GameSessionsPost(
    characterId,
    gameSessionCreate,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **gameSessionCreate** | **GameSessionCreate**|  | |
| **characterId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**GameSessionResponse**

### Authorization

[OAuth2PasswordBearer](../README.md#OAuth2PasswordBearer)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Successful Response |  -  |
|**422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **endSessionApiV1GameSessionsSessionIdEndPost**
> SessionResultResponse endSessionApiV1GameSessionsSessionIdEndPost(endSessionRequest)

セッションを終了  - **session_id**: 終了するセッションのID - **reason**: 終了理由（省略可）

### Example

```typescript
import {
    GameApi,
    Configuration,
    EndSessionRequest
} from './api';

const configuration = new Configuration();
const apiInstance = new GameApi(configuration);

let sessionId: string; // (default to undefined)
let endSessionRequest: EndSessionRequest; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.endSessionApiV1GameSessionsSessionIdEndPost(
    sessionId,
    endSessionRequest,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **endSessionRequest** | **EndSessionRequest**|  | |
| **sessionId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**SessionResultResponse**

### Authorization

[OAuth2PasswordBearer](../README.md#OAuth2PasswordBearer)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Successful Response |  -  |
|**422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **getActiveSessionApiV1GameSessionsActiveGet**
> GameSessionResponse getActiveSessionApiV1GameSessionsActiveGet()

指定されたキャラクターのアクティブなセッションを取得  - **character_id**: チェックするキャラクターのID

### Example

```typescript
import {
    GameApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new GameApi(configuration);

let characterId: string; //Character ID to check for active session (default to undefined)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getActiveSessionApiV1GameSessionsActiveGet(
    characterId,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **characterId** | [**string**] | Character ID to check for active session | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**GameSessionResponse**

### Authorization

[OAuth2PasswordBearer](../README.md#OAuth2PasswordBearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Successful Response |  -  |
|**422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **getSessionApiV1GameSessionsSessionIdGet**
> GameSessionResponse getSessionApiV1GameSessionsSessionIdGet()

セッションの詳細情報を取得  - **session_id**: 取得するセッションのID

### Example

```typescript
import {
    GameApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new GameApi(configuration);

let sessionId: string; // (default to undefined)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getSessionApiV1GameSessionsSessionIdGet(
    sessionId,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **sessionId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**GameSessionResponse**

### Authorization

[OAuth2PasswordBearer](../README.md#OAuth2PasswordBearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Successful Response |  -  |
|**422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **getSessionHistoryApiV1GameSessionsHistoryGet**
> SessionHistoryResponse getSessionHistoryApiV1GameSessionsHistoryGet()

セッション履歴を取得  - **character_id**: 特定のキャラクターでフィルター（省略可） - **skip**: スキップするレコード数 - **limit**: 取得する最大レコード数

### Example

```typescript
import {
    GameApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new GameApi(configuration);

let characterId: string; //Filter by character ID (optional) (default to undefined)
let skip: number; //Number of records to skip (optional) (default to 0)
let limit: number; //Maximum number of records to return (optional) (default to 20)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getSessionHistoryApiV1GameSessionsHistoryGet(
    characterId,
    skip,
    limit,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **characterId** | [**string**] | Filter by character ID | (optional) defaults to undefined|
| **skip** | [**number**] | Number of records to skip | (optional) defaults to 0|
| **limit** | [**number**] | Maximum number of records to return | (optional) defaults to 20|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**SessionHistoryResponse**

### Authorization

[OAuth2PasswordBearer](../README.md#OAuth2PasswordBearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Successful Response |  -  |
|**422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

