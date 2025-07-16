# LogFragmentsApi

All URIs are relative to _http://localhost_

| Method                                                                                                                                          | HTTP request                                                         | Description             |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------- |
| [**getCharacterFragmentsApiV1LogFragmentsCharacterIdFragmentsGet**](#getcharacterfragmentsapiv1logfragmentscharacteridfragmentsget)             | **GET** /api/v1/log-fragments/{character_id}/fragments               | Get Character Fragments |
| [**getFragmentDetailApiV1LogFragmentsCharacterIdFragmentsFragmentIdGet**](#getfragmentdetailapiv1logfragmentscharacteridfragmentsfragmentidget) | **GET** /api/v1/log-fragments/{character_id}/fragments/{fragment_id} | Get Fragment Detail     |

# **getCharacterFragmentsApiV1LogFragmentsCharacterIdFragmentsGet**

> LogFragmentListResponse getCharacterFragmentsApiV1LogFragmentsCharacterIdFragmentsGet()

キャラクターが所有するログフラグメントを取得

### Example

```typescript
import { LogFragmentsApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new LogFragmentsApi(configuration)

let characterId: string // (default to undefined)
let rarity: LogFragmentRarity //レアリティでフィルタ (optional) (default to undefined)
let keyword: string //キーワードで検索 (optional) (default to undefined)
let limit: number // (optional) (default to 20)
let offset: number // (optional) (default to 0)
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.getCharacterFragmentsApiV1LogFragmentsCharacterIdFragmentsGet(
    characterId,
    rarity,
    keyword,
    limit,
    offset,
    authToken
  )
```

### Parameters

| Name            | Type                  | Description          | Notes                            |
| --------------- | --------------------- | -------------------- | -------------------------------- |
| **characterId** | [**string**]          |                      | defaults to undefined            |
| **rarity**      | **LogFragmentRarity** | レアリティでフィルタ | (optional) defaults to undefined |
| **keyword**     | [**string**]          | キーワードで検索     | (optional) defaults to undefined |
| **limit**       | [**number**]          |                      | (optional) defaults to 20        |
| **offset**      | [**number**]          |                      | (optional) defaults to 0         |
| **authToken**   | [**string**]          |                      | (optional) defaults to undefined |

### Return type

**LogFragmentListResponse**

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

# **getFragmentDetailApiV1LogFragmentsCharacterIdFragmentsFragmentIdGet**

> LogFragmentDetail getFragmentDetailApiV1LogFragmentsCharacterIdFragmentsFragmentIdGet()

特定のログフラグメントの詳細を取得

### Example

```typescript
import { LogFragmentsApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new LogFragmentsApi(configuration)

let fragmentId: string // (default to undefined)
let characterId: string // (default to undefined)
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.getFragmentDetailApiV1LogFragmentsCharacterIdFragmentsFragmentIdGet(
    fragmentId,
    characterId,
    authToken
  )
```

### Parameters

| Name            | Type         | Description | Notes                            |
| --------------- | ------------ | ----------- | -------------------------------- |
| **fragmentId**  | [**string**] |             | defaults to undefined            |
| **characterId** | [**string**] |             | defaults to undefined            |
| **authToken**   | [**string**] |             | (optional) defaults to undefined |

### Return type

**LogFragmentDetail**

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
