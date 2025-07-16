# AdminApi

All URIs are relative to _http://localhost_

| Method                                                                                                                                                | HTTP request                                                  | Description                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------- |
| [**adjustPlayerSpApiV1AdminAdminSpAdjustPost**](#adjustplayerspapiv1adminadminspadjustpost)                                                           | **POST** /api/v1/admin/admin/sp/adjust                        | Adjust Player Sp           |
| [**adjustPlayerSpApiV1AdminAdminSpAdjustPost_0**](#adjustplayerspapiv1adminadminspadjustpost_0)                                                       | **POST** /api/v1/admin/admin/sp/adjust                        | Adjust Player Sp           |
| [**batchAdjustSpApiV1AdminAdminSpBatchAdjustPost**](#batchadjustspapiv1adminadminspbatchadjustpost)                                                   | **POST** /api/v1/admin/admin/sp/batch-adjust                  | Batch Adjust Sp            |
| [**batchAdjustSpApiV1AdminAdminSpBatchAdjustPost_0**](#batchadjustspapiv1adminadminspbatchadjustpost_0)                                               | **POST** /api/v1/admin/admin/sp/batch-adjust                  | Batch Adjust Sp            |
| [**getAllPlayersSpApiV1AdminAdminSpPlayersGet**](#getallplayersspapiv1adminadminspplayersget)                                                         | **GET** /api/v1/admin/admin/sp/players                        | Get All Players Sp         |
| [**getAllPlayersSpApiV1AdminAdminSpPlayersGet_0**](#getallplayersspapiv1adminadminspplayersget_0)                                                     | **GET** /api/v1/admin/admin/sp/players                        | Get All Players Sp         |
| [**getPlayerSpDetailApiV1AdminAdminSpPlayersUserIdGet**](#getplayerspdetailapiv1adminadminspplayersuseridget)                                         | **GET** /api/v1/admin/admin/sp/players/{user_id}              | Get Player Sp Detail       |
| [**getPlayerSpDetailApiV1AdminAdminSpPlayersUserIdGet_0**](#getplayerspdetailapiv1adminadminspplayersuseridget_0)                                     | **GET** /api/v1/admin/admin/sp/players/{user_id}              | Get Player Sp Detail       |
| [**getPlayerSpTransactionsApiV1AdminAdminSpPlayersUserIdTransactionsGet**](#getplayersptransactionsapiv1adminadminspplayersuseridtransactionsget)     | **GET** /api/v1/admin/admin/sp/players/{user_id}/transactions | Get Player Sp Transactions |
| [**getPlayerSpTransactionsApiV1AdminAdminSpPlayersUserIdTransactionsGet_0**](#getplayersptransactionsapiv1adminadminspplayersuseridtransactionsget_0) | **GET** /api/v1/admin/admin/sp/players/{user_id}/transactions | Get Player Sp Transactions |

# **adjustPlayerSpApiV1AdminAdminSpAdjustPost**

> AdminSPAdjustmentResponse adjustPlayerSpApiV1AdminAdminSpAdjustPost(adminSPAdjustment)

プレイヤーのSPを手動で調整。 管理者による付与・減算が可能。

### Example

```typescript
import { AdminApi, Configuration, AdminSPAdjustment } from './api'

const configuration = new Configuration()
const apiInstance = new AdminApi(configuration)

let adminSPAdjustment: AdminSPAdjustment //
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.adjustPlayerSpApiV1AdminAdminSpAdjustPost(
    adminSPAdjustment,
    authToken
  )
```

### Parameters

| Name                  | Type                  | Description | Notes                            |
| --------------------- | --------------------- | ----------- | -------------------------------- |
| **adminSPAdjustment** | **AdminSPAdjustment** |             |                                  |
| **authToken**         | [**string**]          |             | (optional) defaults to undefined |

### Return type

**AdminSPAdjustmentResponse**

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

# **adjustPlayerSpApiV1AdminAdminSpAdjustPost_0**

> AdminSPAdjustmentResponse adjustPlayerSpApiV1AdminAdminSpAdjustPost_0(adminSPAdjustment)

プレイヤーのSPを手動で調整。 管理者による付与・減算が可能。

### Example

```typescript
import { AdminApi, Configuration, AdminSPAdjustment } from './api'

const configuration = new Configuration()
const apiInstance = new AdminApi(configuration)

let adminSPAdjustment: AdminSPAdjustment //
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.adjustPlayerSpApiV1AdminAdminSpAdjustPost_0(
    adminSPAdjustment,
    authToken
  )
```

### Parameters

| Name                  | Type                  | Description | Notes                            |
| --------------------- | --------------------- | ----------- | -------------------------------- |
| **adminSPAdjustment** | **AdminSPAdjustment** |             |                                  |
| **authToken**         | [**string**]          |             | (optional) defaults to undefined |

### Return type

**AdminSPAdjustmentResponse**

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

# **batchAdjustSpApiV1AdminAdminSpBatchAdjustPost**

> Array<AdminSPAdjustmentResponse> batchAdjustSpApiV1AdminAdminSpBatchAdjustPost(adminSPAdjustment)

複数プレイヤーのSPを一括調整。 イベント配布などに使用。

### Example

```typescript
import { AdminApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new AdminApi(configuration)

let adminSPAdjustment: Array<AdminSPAdjustment> //
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.batchAdjustSpApiV1AdminAdminSpBatchAdjustPost(
    adminSPAdjustment,
    authToken
  )
```

### Parameters

| Name                  | Type                         | Description | Notes                            |
| --------------------- | ---------------------------- | ----------- | -------------------------------- |
| **adminSPAdjustment** | **Array<AdminSPAdjustment>** |             |                                  |
| **authToken**         | [**string**]                 |             | (optional) defaults to undefined |

### Return type

**Array<AdminSPAdjustmentResponse>**

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

# **batchAdjustSpApiV1AdminAdminSpBatchAdjustPost_0**

> Array<AdminSPAdjustmentResponse> batchAdjustSpApiV1AdminAdminSpBatchAdjustPost_0(adminSPAdjustment)

複数プレイヤーのSPを一括調整。 イベント配布などに使用。

### Example

```typescript
import { AdminApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new AdminApi(configuration)

let adminSPAdjustment: Array<AdminSPAdjustment> //
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.batchAdjustSpApiV1AdminAdminSpBatchAdjustPost_0(
    adminSPAdjustment,
    authToken
  )
```

### Parameters

| Name                  | Type                         | Description | Notes                            |
| --------------------- | ---------------------------- | ----------- | -------------------------------- |
| **adminSPAdjustment** | **Array<AdminSPAdjustment>** |             |                                  |
| **authToken**         | [**string**]                 |             | (optional) defaults to undefined |

### Return type

**Array<AdminSPAdjustmentResponse>**

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

# **getAllPlayersSpApiV1AdminAdminSpPlayersGet**

> Array<PlayerSPDetail> getAllPlayersSpApiV1AdminAdminSpPlayersGet()

全プレイヤーのSP情報を取得。 検索機能付き（ユーザー名、メールアドレス）。

### Example

```typescript
import { AdminApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new AdminApi(configuration)

let skip: number // (optional) (default to 0)
let limit: number // (optional) (default to 100)
let search: string // (optional) (default to undefined)
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.getAllPlayersSpApiV1AdminAdminSpPlayersGet(
    skip,
    limit,
    search,
    authToken
  )
```

### Parameters

| Name          | Type         | Description | Notes                            |
| ------------- | ------------ | ----------- | -------------------------------- |
| **skip**      | [**number**] |             | (optional) defaults to 0         |
| **limit**     | [**number**] |             | (optional) defaults to 100       |
| **search**    | [**string**] |             | (optional) defaults to undefined |
| **authToken** | [**string**] |             | (optional) defaults to undefined |

### Return type

**Array<PlayerSPDetail>**

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

# **getAllPlayersSpApiV1AdminAdminSpPlayersGet_0**

> Array<PlayerSPDetail> getAllPlayersSpApiV1AdminAdminSpPlayersGet_0()

全プレイヤーのSP情報を取得。 検索機能付き（ユーザー名、メールアドレス）。

### Example

```typescript
import { AdminApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new AdminApi(configuration)

let skip: number // (optional) (default to 0)
let limit: number // (optional) (default to 100)
let search: string // (optional) (default to undefined)
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.getAllPlayersSpApiV1AdminAdminSpPlayersGet_0(
    skip,
    limit,
    search,
    authToken
  )
```

### Parameters

| Name          | Type         | Description | Notes                            |
| ------------- | ------------ | ----------- | -------------------------------- |
| **skip**      | [**number**] |             | (optional) defaults to 0         |
| **limit**     | [**number**] |             | (optional) defaults to 100       |
| **search**    | [**string**] |             | (optional) defaults to undefined |
| **authToken** | [**string**] |             | (optional) defaults to undefined |

### Return type

**Array<PlayerSPDetail>**

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

# **getPlayerSpDetailApiV1AdminAdminSpPlayersUserIdGet**

> PlayerSPDetail getPlayerSpDetailApiV1AdminAdminSpPlayersUserIdGet()

特定プレイヤーのSP情報を取得。

### Example

```typescript
import { AdminApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new AdminApi(configuration)

let userId: string // (default to undefined)
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.getPlayerSpDetailApiV1AdminAdminSpPlayersUserIdGet(
    userId,
    authToken
  )
```

### Parameters

| Name          | Type         | Description | Notes                            |
| ------------- | ------------ | ----------- | -------------------------------- |
| **userId**    | [**string**] |             | defaults to undefined            |
| **authToken** | [**string**] |             | (optional) defaults to undefined |

### Return type

**PlayerSPDetail**

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

# **getPlayerSpDetailApiV1AdminAdminSpPlayersUserIdGet_0**

> PlayerSPDetail getPlayerSpDetailApiV1AdminAdminSpPlayersUserIdGet_0()

特定プレイヤーのSP情報を取得。

### Example

```typescript
import { AdminApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new AdminApi(configuration)

let userId: string // (default to undefined)
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.getPlayerSpDetailApiV1AdminAdminSpPlayersUserIdGet_0(
    userId,
    authToken
  )
```

### Parameters

| Name          | Type         | Description | Notes                            |
| ------------- | ------------ | ----------- | -------------------------------- |
| **userId**    | [**string**] |             | defaults to undefined            |
| **authToken** | [**string**] |             | (optional) defaults to undefined |

### Return type

**PlayerSPDetail**

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

# **getPlayerSpTransactionsApiV1AdminAdminSpPlayersUserIdTransactionsGet**

> SPTransactionHistory getPlayerSpTransactionsApiV1AdminAdminSpPlayersUserIdTransactionsGet()

特定プレイヤーのSP取引履歴を取得。

### Example

```typescript
import { AdminApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new AdminApi(configuration)

let userId: string // (default to undefined)
let skip: number // (optional) (default to 0)
let limit: number // (optional) (default to 50)
let transactionType: SPTransactionType // (optional) (default to undefined)
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.getPlayerSpTransactionsApiV1AdminAdminSpPlayersUserIdTransactionsGet(
    userId,
    skip,
    limit,
    transactionType,
    authToken
  )
```

### Parameters

| Name                | Type                  | Description | Notes                            |
| ------------------- | --------------------- | ----------- | -------------------------------- |
| **userId**          | [**string**]          |             | defaults to undefined            |
| **skip**            | [**number**]          |             | (optional) defaults to 0         |
| **limit**           | [**number**]          |             | (optional) defaults to 50        |
| **transactionType** | **SPTransactionType** |             | (optional) defaults to undefined |
| **authToken**       | [**string**]          |             | (optional) defaults to undefined |

### Return type

**SPTransactionHistory**

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

# **getPlayerSpTransactionsApiV1AdminAdminSpPlayersUserIdTransactionsGet_0**

> SPTransactionHistory getPlayerSpTransactionsApiV1AdminAdminSpPlayersUserIdTransactionsGet_0()

特定プレイヤーのSP取引履歴を取得。

### Example

```typescript
import { AdminApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new AdminApi(configuration)

let userId: string // (default to undefined)
let skip: number // (optional) (default to 0)
let limit: number // (optional) (default to 50)
let transactionType: SPTransactionType // (optional) (default to undefined)
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.getPlayerSpTransactionsApiV1AdminAdminSpPlayersUserIdTransactionsGet_0(
    userId,
    skip,
    limit,
    transactionType,
    authToken
  )
```

### Parameters

| Name                | Type                  | Description | Notes                            |
| ------------------- | --------------------- | ----------- | -------------------------------- |
| **userId**          | [**string**]          |             | defaults to undefined            |
| **skip**            | [**number**]          |             | (optional) defaults to 0         |
| **limit**           | [**number**]          |             | (optional) defaults to 50        |
| **transactionType** | **SPTransactionType** |             | (optional) defaults to undefined |
| **authToken**       | [**string**]          |             | (optional) defaults to undefined |

### Return type

**SPTransactionHistory**

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
