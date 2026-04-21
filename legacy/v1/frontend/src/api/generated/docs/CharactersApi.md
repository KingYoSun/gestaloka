# CharactersApi

All URIs are relative to *http://localhost*

|Method | HTTP request | Description|
|------------- | ------------- | -------------|
|[**activateCharacterApiV1CharactersCharacterIdActivatePost**](#activatecharacterapiv1characterscharacteridactivatepost) | **POST** /api/v1/characters/{character_id}/activate | Activate Character|
|[**createCharacterApiV1CharactersPost**](#createcharacterapiv1characterspost) | **POST** /api/v1/characters/ | Create Character|
|[**deleteCharacterApiV1CharactersCharacterIdDelete**](#deletecharacterapiv1characterscharacteriddelete) | **DELETE** /api/v1/characters/{character_id} | Delete Character|
|[**getCharacterApiV1CharactersCharacterIdGet**](#getcharacterapiv1characterscharacteridget) | **GET** /api/v1/characters/{character_id} | Get Character|
|[**getUserCharactersApiV1CharactersGet**](#getusercharactersapiv1charactersget) | **GET** /api/v1/characters/ | Get User Characters|
|[**updateCharacterApiV1CharactersCharacterIdPut**](#updatecharacterapiv1characterscharacteridput) | **PUT** /api/v1/characters/{character_id} | Update Character|

# **activateCharacterApiV1CharactersCharacterIdActivatePost**
> Character activateCharacterApiV1CharactersCharacterIdActivatePost()

キャラクターをアクティブにする

### Example

```typescript
import {
    CharactersApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new CharactersApi(configuration);

let characterId: string; // (default to undefined)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.activateCharacterApiV1CharactersCharacterIdActivatePost(
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

**Character**

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

# **createCharacterApiV1CharactersPost**
> Character createCharacterApiV1CharactersPost(characterCreate)

新しいキャラクター作成

### Example

```typescript
import {
    CharactersApi,
    Configuration,
    CharacterCreate
} from './api';

const configuration = new Configuration();
const apiInstance = new CharactersApi(configuration);

let characterCreate: CharacterCreate; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.createCharacterApiV1CharactersPost(
    characterCreate,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **characterCreate** | **CharacterCreate**|  | |
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**Character**

### Authorization

[OAuth2PasswordBearer](../README.md#OAuth2PasswordBearer)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**201** | Successful Response |  -  |
|**422** | Validation Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **deleteCharacterApiV1CharactersCharacterIdDelete**
> any deleteCharacterApiV1CharactersCharacterIdDelete()

キャラクター削除

### Example

```typescript
import {
    CharactersApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new CharactersApi(configuration);

let characterId: string; // (default to undefined)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.deleteCharacterApiV1CharactersCharacterIdDelete(
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

**any**

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

# **getCharacterApiV1CharactersCharacterIdGet**
> Character getCharacterApiV1CharactersCharacterIdGet()

特定のキャラクター取得

### Example

```typescript
import {
    CharactersApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new CharactersApi(configuration);

let characterId: string; // (default to undefined)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getCharacterApiV1CharactersCharacterIdGet(
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

**Character**

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

# **getUserCharactersApiV1CharactersGet**
> Array<Character> getUserCharactersApiV1CharactersGet()

ユーザーのキャラクター一覧取得

### Example

```typescript
import {
    CharactersApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new CharactersApi(configuration);

let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getUserCharactersApiV1CharactersGet(
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**Array<Character>**

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

# **updateCharacterApiV1CharactersCharacterIdPut**
> Character updateCharacterApiV1CharactersCharacterIdPut(characterUpdate)

キャラクター更新

### Example

```typescript
import {
    CharactersApi,
    Configuration,
    CharacterUpdate
} from './api';

const configuration = new Configuration();
const apiInstance = new CharactersApi(configuration);

let characterId: string; // (default to undefined)
let characterUpdate: CharacterUpdate; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.updateCharacterApiV1CharactersCharacterIdPut(
    characterId,
    characterUpdate,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **characterUpdate** | **CharacterUpdate**|  | |
| **characterId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**Character**

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

