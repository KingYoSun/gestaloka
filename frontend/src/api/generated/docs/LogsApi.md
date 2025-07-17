# LogsApi

All URIs are relative to *http://localhost*

|Method | HTTP request | Description|
|------------- | ------------- | -------------|
|[**createCompletedLogApiV1LogsCompletedPost**](#createcompletedlogapiv1logscompletedpost) | **POST** /api/v1/logs/completed | Create Completed Log|
|[**createLogFragmentApiV1LogsFragmentsPost**](#createlogfragmentapiv1logsfragmentspost) | **POST** /api/v1/logs/fragments | Create Log Fragment|
|[**createPurificationItemFromFragmentsApiV1LogsFragmentsCreatePurificationItemPost**](#createpurificationitemfromfragmentsapiv1logsfragmentscreatepurificationitempost) | **POST** /api/v1/logs/fragments/create-purification-item | Create Purification Item From Fragments|
|[**getCharacterCompletedLogsApiV1LogsCompletedCharacterIdGet**](#getcharactercompletedlogsapiv1logscompletedcharacteridget) | **GET** /api/v1/logs/completed/{character_id} | Get Character Completed Logs|
|[**getCharacterFragmentsApiV1LogsFragmentsCharacterIdGet**](#getcharacterfragmentsapiv1logsfragmentscharacteridget) | **GET** /api/v1/logs/fragments/{character_id} | Get Character Fragments|
|[**previewCompilationCostApiV1LogsCompletedPreviewPost**](#previewcompilationcostapiv1logscompletedpreviewpost) | **POST** /api/v1/logs/completed/preview | Preview Compilation Cost|
|[**purifyCompletedLogApiV1LogsCompletedLogIdPurifyPost**](#purifycompletedlogapiv1logscompletedlogidpurifypost) | **POST** /api/v1/logs/completed/{log_id}/purify | Purify Completed Log|
|[**updateCompletedLogApiV1LogsCompletedLogIdPatch**](#updatecompletedlogapiv1logscompletedlogidpatch) | **PATCH** /api/v1/logs/completed/{log_id} | Update Completed Log|

# **createCompletedLogApiV1LogsCompletedPost**
> CompletedLogRead createCompletedLogApiV1LogsCompletedPost(completedLogCreate)

完成ログを作成（ログフラグメントの編纂）  複数のログフラグメントを組み合わせて、 他プレイヤーの世界でNPCとして活動可能な完全な記録を作成。

### Example

```typescript
import {
    LogsApi,
    Configuration,
    CompletedLogCreate
} from './api';

const configuration = new Configuration();
const apiInstance = new LogsApi(configuration);

let completedLogCreate: CompletedLogCreate; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.createCompletedLogApiV1LogsCompletedPost(
    completedLogCreate,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **completedLogCreate** | **CompletedLogCreate**|  | |
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**CompletedLogRead**

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

# **createLogFragmentApiV1LogsFragmentsPost**
> LogFragmentRead createLogFragmentApiV1LogsFragmentsPost(logFragmentCreate)

ログの欠片を作成  重要な行動や決断から生成される記録の断片。 GMのAIによって自動生成される。

### Example

```typescript
import {
    LogsApi,
    Configuration,
    LogFragmentCreate
} from './api';

const configuration = new Configuration();
const apiInstance = new LogsApi(configuration);

let logFragmentCreate: LogFragmentCreate; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.createLogFragmentApiV1LogsFragmentsPost(
    logFragmentCreate,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **logFragmentCreate** | **LogFragmentCreate**|  | |
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**LogFragmentRead**

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

# **createPurificationItemFromFragmentsApiV1LogsFragmentsCreatePurificationItemPost**
> any createPurificationItemFromFragmentsApiV1LogsFragmentsCreatePurificationItemPost(requestBody)

フラグメントから浄化アイテムを作成  ポジティブなフラグメントを組み合わせて浄化アイテムを生成

### Example

```typescript
import {
    LogsApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new LogsApi(configuration);

let requestBody: Array<string | null>; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.createPurificationItemFromFragmentsApiV1LogsFragmentsCreatePurificationItemPost(
    requestBody,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **requestBody** | **Array<string | null>**|  | |
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**any**

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

# **getCharacterCompletedLogsApiV1LogsCompletedCharacterIdGet**
> Array<CompletedLogRead> getCharacterCompletedLogsApiV1LogsCompletedCharacterIdGet()

キャラクターの完成ログ一覧を取得

### Example

```typescript
import {
    LogsApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new LogsApi(configuration);

let characterId: string; // (default to undefined)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getCharacterCompletedLogsApiV1LogsCompletedCharacterIdGet(
    characterId,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **characterId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**Array<CompletedLogRead>**

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

# **getCharacterFragmentsApiV1LogsFragmentsCharacterIdGet**
> Array<LogFragmentRead> getCharacterFragmentsApiV1LogsFragmentsCharacterIdGet()

キャラクターのログフラグメント一覧を取得

### Example

```typescript
import {
    LogsApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new LogsApi(configuration);

let characterId: string; // (default to undefined)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getCharacterFragmentsApiV1LogsFragmentsCharacterIdGet(
    characterId,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **characterId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**Array<LogFragmentRead>**

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

# **previewCompilationCostApiV1LogsCompletedPreviewPost**
> any previewCompilationCostApiV1LogsCompletedPreviewPost(completedLogCreate)

編纂コストとボーナスをプレビュー  実際にSPを消費せずに、編纂時のコストとボーナスを確認できる

### Example

```typescript
import {
    LogsApi,
    Configuration,
    CompletedLogCreate
} from './api';

const configuration = new Configuration();
const apiInstance = new LogsApi(configuration);

let completedLogCreate: CompletedLogCreate; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.previewCompilationCostApiV1LogsCompletedPreviewPost(
    completedLogCreate,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **completedLogCreate** | **CompletedLogCreate**|  | |
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**any**

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

# **purifyCompletedLogApiV1LogsCompletedLogIdPurifyPost**
> any purifyCompletedLogApiV1LogsCompletedLogIdPurifyPost(requestBody)

完成ログの汚染を浄化  浄化アイテムとSPを消費して、ログの汚染度を下げる

### Example

```typescript
import {
    LogsApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new LogsApi(configuration);

let logId: string; // (default to undefined)
let requestBody: Array<string | null>; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.purifyCompletedLogApiV1LogsCompletedLogIdPurifyPost(
    logId,
    requestBody,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **requestBody** | **Array<string | null>**|  | |
| **logId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**any**

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

# **updateCompletedLogApiV1LogsCompletedLogIdPatch**
> CompletedLogRead updateCompletedLogApiV1LogsCompletedLogIdPatch(completedLogUpdate)

完成ログを更新

### Example

```typescript
import {
    LogsApi,
    Configuration,
    CompletedLogUpdate
} from './api';

const configuration = new Configuration();
const apiInstance = new LogsApi(configuration);

let logId: string; // (default to undefined)
let completedLogUpdate: CompletedLogUpdate; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.updateCompletedLogApiV1LogsCompletedLogIdPatch(
    logId,
    completedLogUpdate,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **completedLogUpdate** | **CompletedLogUpdate**|  | |
| **logId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**CompletedLogRead**

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

