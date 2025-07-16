# TitlesApi

All URIs are relative to _http://localhost_

| Method                                                                                | HTTP request                            | Description          |
| ------------------------------------------------------------------------------------- | --------------------------------------- | -------------------- |
| [**equipTitleApiV1TitlesTitleIdEquipPut**](#equiptitleapiv1titlestitleidequipput)     | **PUT** /api/v1/titles/{title_id}/equip | Equip Title          |
| [**getCharacterTitlesApiV1TitlesGet**](#getcharactertitlesapiv1titlesget)             | **GET** /api/v1/titles/                 | Get Character Titles |
| [**getEquippedTitleApiV1TitlesEquippedGet**](#getequippedtitleapiv1titlesequippedget) | **GET** /api/v1/titles/equipped         | Get Equipped Title   |
| [**unequipAllTitlesApiV1TitlesUnequipPut**](#unequipalltitlesapiv1titlesunequipput)   | **PUT** /api/v1/titles/unequip          | Unequip All Titles   |

# **equipTitleApiV1TitlesTitleIdEquipPut**

> CharacterTitleRead equipTitleApiV1TitlesTitleIdEquipPut()

Equip a specific title.

### Example

```typescript
import { TitlesApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new TitlesApi(configuration)

let titleId: string // (default to undefined)
let authToken: string // (optional) (default to undefined)

const { status, data } = await apiInstance.equipTitleApiV1TitlesTitleIdEquipPut(
  titleId,
  authToken
)
```

### Parameters

| Name          | Type         | Description | Notes                            |
| ------------- | ------------ | ----------- | -------------------------------- |
| **titleId**   | [**string**] |             | defaults to undefined            |
| **authToken** | [**string**] |             | (optional) defaults to undefined |

### Return type

**CharacterTitleRead**

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

# **getCharacterTitlesApiV1TitlesGet**

> Array<CharacterTitleRead> getCharacterTitlesApiV1TitlesGet()

Get all titles for the current user\'s character.

### Example

```typescript
import { TitlesApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new TitlesApi(configuration)

let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.getCharacterTitlesApiV1TitlesGet(authToken)
```

### Parameters

| Name          | Type         | Description | Notes                            |
| ------------- | ------------ | ----------- | -------------------------------- |
| **authToken** | [**string**] |             | (optional) defaults to undefined |

### Return type

**Array<CharacterTitleRead>**

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

# **getEquippedTitleApiV1TitlesEquippedGet**

> CharacterTitleRead getEquippedTitleApiV1TitlesEquippedGet()

Get the currently equipped title.

### Example

```typescript
import { TitlesApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new TitlesApi(configuration)

let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.getEquippedTitleApiV1TitlesEquippedGet(authToken)
```

### Parameters

| Name          | Type         | Description | Notes                            |
| ------------- | ------------ | ----------- | -------------------------------- |
| **authToken** | [**string**] |             | (optional) defaults to undefined |

### Return type

**CharacterTitleRead**

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

# **unequipAllTitlesApiV1TitlesUnequipPut**

> object unequipAllTitlesApiV1TitlesUnequipPut()

Unequip all titles.

### Example

```typescript
import { TitlesApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new TitlesApi(configuration)

let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.unequipAllTitlesApiV1TitlesUnequipPut(authToken)
```

### Parameters

| Name          | Type         | Description | Notes                            |
| ------------- | ------------ | ----------- | -------------------------------- |
| **authToken** | [**string**] |             | (optional) defaults to undefined |

### Return type

**object**

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
