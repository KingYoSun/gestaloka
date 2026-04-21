# MemoryInheritanceApi

All URIs are relative to *http://localhost*

|Method | HTTP request | Description|
|------------- | ------------- | -------------|
|[**executeInheritanceApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritanceExecutePost**](#executeinheritanceapiv1memoryinheritancecharacterscharacteridmemoryinheritanceexecutepost) | **POST** /api/v1/memory-inheritance/characters/{character_id}/memory-inheritance/execute | 記憶継承の実行|
|[**getCombinationPreviewApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritancePreviewGet**](#getcombinationpreviewapiv1memoryinheritancecharacterscharacteridmemoryinheritancepreviewget) | **GET** /api/v1/memory-inheritance/characters/{character_id}/memory-inheritance/preview | 記憶組み合わせのプレビュー取得|
|[**getInheritanceHistoryApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritanceHistoryGet**](#getinheritancehistoryapiv1memoryinheritancecharacterscharacteridmemoryinheritancehistoryget) | **GET** /api/v1/memory-inheritance/characters/{character_id}/memory-inheritance/history | 記憶継承履歴の取得|
|[**getLogEnhancementsApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritanceEnhancementsGet**](#getlogenhancementsapiv1memoryinheritancecharacterscharacteridmemoryinheritanceenhancementsget) | **GET** /api/v1/memory-inheritance/characters/{character_id}/memory-inheritance/enhancements | ログ強化情報の取得|

# **executeInheritanceApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritanceExecutePost**
> MemoryInheritanceResult executeInheritanceApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritanceExecutePost(memoryInheritanceRequest)

指定した記憶フラグメントを組み合わせて新しい価値を創造

### Example

```typescript
import {
    MemoryInheritanceApi,
    Configuration,
    MemoryInheritanceRequest
} from './api';

const configuration = new Configuration();
const apiInstance = new MemoryInheritanceApi(configuration);

let characterId: string; // (default to undefined)
let memoryInheritanceRequest: MemoryInheritanceRequest; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.executeInheritanceApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritanceExecutePost(
    characterId,
    memoryInheritanceRequest,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **memoryInheritanceRequest** | **MemoryInheritanceRequest**|  | |
| **characterId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**MemoryInheritanceResult**

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

# **getCombinationPreviewApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritancePreviewGet**
> MemoryCombinationPreview getCombinationPreviewApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritancePreviewGet(requestBody)

指定した記憶フラグメントの組み合わせで可能な継承タイプとその効果をプレビュー

### Example

```typescript
import {
    MemoryInheritanceApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new MemoryInheritanceApi(configuration);

let characterId: string; // (default to undefined)
let requestBody: Array<string>; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getCombinationPreviewApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritancePreviewGet(
    characterId,
    requestBody,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **requestBody** | **Array<string>**|  | |
| **characterId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**MemoryCombinationPreview**

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

# **getInheritanceHistoryApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritanceHistoryGet**
> Array<InheritanceHistoryEntry> getInheritanceHistoryApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritanceHistoryGet()

過去の記憶継承履歴を取得

### Example

```typescript
import {
    MemoryInheritanceApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new MemoryInheritanceApi(configuration);

let characterId: string; // (default to undefined)
let limit: number; // (optional) (default to 50)
let offset: number; // (optional) (default to 0)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getInheritanceHistoryApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritanceHistoryGet(
    characterId,
    limit,
    offset,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **characterId** | [**string**] |  | defaults to undefined|
| **limit** | [**number**] |  | (optional) defaults to 50|
| **offset** | [**number**] |  | (optional) defaults to 0|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**Array<InheritanceHistoryEntry>**

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

# **getLogEnhancementsApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritanceEnhancementsGet**
> Array<object> getLogEnhancementsApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritanceEnhancementsGet()

キャラクターが保有するログ強化効果の一覧を取得

### Example

```typescript
import {
    MemoryInheritanceApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new MemoryInheritanceApi(configuration);

let characterId: string; // (default to undefined)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getLogEnhancementsApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritanceEnhancementsGet(
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

**Array<object>**

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

