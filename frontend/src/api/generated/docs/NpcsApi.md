# NpcsApi

All URIs are relative to _http://localhost_

| Method                                                                                                                | HTTP request                                        | Description          |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------- |
| [**getNpcApiV1NpcsNpcsNpcIdGet**](#getnpcapiv1npcsnpcsnpcidget)                                                       | **GET** /api/v1/npcs/npcs/{npc_id}                  | Get Npc              |
| [**getNpcsInLocationApiV1NpcsLocationsLocationNameNpcsGet**](#getnpcsinlocationapiv1npcslocationslocationnamenpcsget) | **GET** /api/v1/npcs/locations/{location_name}/npcs | Get Npcs In Location |
| [**listNpcsApiV1NpcsNpcsGet**](#listnpcsapiv1npcsnpcsget)                                                             | **GET** /api/v1/npcs/npcs                           | List Npcs            |
| [**moveNpcApiV1NpcsNpcsNpcIdMovePost**](#movenpcapiv1npcsnpcsnpcidmovepost)                                           | **POST** /api/v1/npcs/npcs/{npc_id}/move            | Move Npc             |

# **getNpcApiV1NpcsNpcsNpcIdGet**

> NPCProfile getNpcApiV1NpcsNpcsNpcIdGet()

特定のNPCの詳細を取得

### Example

```typescript
import { NpcsApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new NpcsApi(configuration)

let npcId: string // (default to undefined)
let authToken: string // (optional) (default to undefined)

const { status, data } = await apiInstance.getNpcApiV1NpcsNpcsNpcIdGet(
  npcId,
  authToken
)
```

### Parameters

| Name          | Type         | Description | Notes                            |
| ------------- | ------------ | ----------- | -------------------------------- |
| **npcId**     | [**string**] |             | defaults to undefined            |
| **authToken** | [**string**] |             | (optional) defaults to undefined |

### Return type

**NPCProfile**

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

# **getNpcsInLocationApiV1NpcsLocationsLocationNameNpcsGet**

> Array<NPCProfile> getNpcsInLocationApiV1NpcsLocationsLocationNameNpcsGet()

特定の場所にいるNPCの一覧を取得

### Example

```typescript
import { NpcsApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new NpcsApi(configuration)

let locationName: string // (default to undefined)
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.getNpcsInLocationApiV1NpcsLocationsLocationNameNpcsGet(
    locationName,
    authToken
  )
```

### Parameters

| Name             | Type         | Description | Notes                            |
| ---------------- | ------------ | ----------- | -------------------------------- |
| **locationName** | [**string**] |             | defaults to undefined            |
| **authToken**    | [**string**] |             | (optional) defaults to undefined |

### Return type

**Array<NPCProfile>**

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

# **listNpcsApiV1NpcsNpcsGet**

> Array<NPCProfile> listNpcsApiV1NpcsNpcsGet()

NPCの一覧を取得 フィルタリング: - location: 特定の場所にいるNPCのみ - npc_type: LOG_NPC, PERMANENT_NPC, TEMPORARY_NPC - is_active: アクティブなNPCのみ

### Example

```typescript
import { NpcsApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new NpcsApi(configuration)

let location: string // (optional) (default to undefined)
let npcType: string // (optional) (default to undefined)
let isActive: boolean // (optional) (default to true)
let authToken: string // (optional) (default to undefined)

const { status, data } = await apiInstance.listNpcsApiV1NpcsNpcsGet(
  location,
  npcType,
  isActive,
  authToken
)
```

### Parameters

| Name          | Type          | Description | Notes                            |
| ------------- | ------------- | ----------- | -------------------------------- |
| **location**  | [**string**]  |             | (optional) defaults to undefined |
| **npcType**   | [**string**]  |             | (optional) defaults to undefined |
| **isActive**  | [**boolean**] |             | (optional) defaults to true      |
| **authToken** | [**string**]  |             | (optional) defaults to undefined |

### Return type

**Array<NPCProfile>**

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

# **moveNpcApiV1NpcsNpcsNpcIdMovePost**

> object moveNpcApiV1NpcsNpcsNpcIdMovePost(nPCLocationUpdate)

NPCを別の場所に移動（GM権限が必要）

### Example

```typescript
import { NpcsApi, Configuration, NPCLocationUpdate } from './api'

const configuration = new Configuration()
const apiInstance = new NpcsApi(configuration)

let npcId: string // (default to undefined)
let nPCLocationUpdate: NPCLocationUpdate //
let authToken: string // (optional) (default to undefined)

const { status, data } = await apiInstance.moveNpcApiV1NpcsNpcsNpcIdMovePost(
  npcId,
  nPCLocationUpdate,
  authToken
)
```

### Parameters

| Name                  | Type                  | Description | Notes                            |
| --------------------- | --------------------- | ----------- | -------------------------------- |
| **nPCLocationUpdate** | **NPCLocationUpdate** |             |                                  |
| **npcId**             | [**string**]          |             | defaults to undefined            |
| **authToken**         | [**string**]          |             | (optional) defaults to undefined |

### Return type

**object**

### Authorization

[OAuth2PasswordBearer](../README.md#OAuth2PasswordBearer)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

### HTTP response details

| Status code | Description         | Response headers |
| ----------- | ------------------- | ---------------- |
| **200**     | Successful Response | -                |
| **422**     | Validation Error    | -                |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)
