# NarrativeApi

All URIs are relative to *http://localhost*

|Method | HTTP request | Description|
|------------- | ------------- | -------------|
|[**getAvailableActionsApiV1NarrativeCharacterIdActionsGet**](#getavailableactionsapiv1narrativecharacteridactionsget) | **GET** /api/v1/narrative/{character_id}/actions | Get Available Actions|
|[**performNarrativeActionApiV1NarrativeCharacterIdActionPost**](#performnarrativeactionapiv1narrativecharacteridactionpost) | **POST** /api/v1/narrative/{character_id}/action | Perform Narrative Action|

# **getAvailableActionsApiV1NarrativeCharacterIdActionsGet**
> Array<ActionChoice> getAvailableActionsApiV1NarrativeCharacterIdActionsGet()

現在の状況に応じた行動選択肢を取得

### Example

```typescript
import {
    NarrativeApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new NarrativeApi(configuration);

let characterId: string; // (default to undefined)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getAvailableActionsApiV1NarrativeCharacterIdActionsGet(
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

**Array<ActionChoice>**

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

# **performNarrativeActionApiV1NarrativeCharacterIdActionPost**
> NarrativeResponse performNarrativeActionApiV1NarrativeCharacterIdActionPost(actionRequest)

物語主導の行動処理

### Example

```typescript
import {
    NarrativeApi,
    Configuration,
    ActionRequest
} from './api';

const configuration = new Configuration();
const apiInstance = new NarrativeApi(configuration);

let characterId: string; // (default to undefined)
let actionRequest: ActionRequest; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.performNarrativeActionApiV1NarrativeCharacterIdActionPost(
    characterId,
    actionRequest,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **actionRequest** | **ActionRequest**|  | |
| **characterId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**NarrativeResponse**

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

