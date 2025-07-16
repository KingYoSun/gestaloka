# SpSubscriptionsApi

All URIs are relative to _http://localhost_

| Method                                                                                                            | HTTP request                               | Description              |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------ |
| [**cancelSubscriptionApiV1SpSubscriptionsCancelPost**](#cancelsubscriptionapiv1spsubscriptionscancelpost)         | **POST** /api/v1/sp/subscriptions/cancel   | Cancel Subscription      |
| [**getCurrentSubscriptionApiV1SpSubscriptionsCurrentGet**](#getcurrentsubscriptionapiv1spsubscriptionscurrentget) | **GET** /api/v1/sp/subscriptions/current   | Get Current Subscription |
| [**getSubscriptionHistoryApiV1SpSubscriptionsHistoryGet**](#getsubscriptionhistoryapiv1spsubscriptionshistoryget) | **GET** /api/v1/sp/subscriptions/history   | Get Subscription History |
| [**getSubscriptionPlansApiV1SpSubscriptionsPlansGet**](#getsubscriptionplansapiv1spsubscriptionsplansget)         | **GET** /api/v1/sp/subscriptions/plans     | Get Subscription Plans   |
| [**purchaseSubscriptionApiV1SpSubscriptionsPurchasePost**](#purchasesubscriptionapiv1spsubscriptionspurchasepost) | **POST** /api/v1/sp/subscriptions/purchase | Purchase Subscription    |
| [**updateSubscriptionApiV1SpSubscriptionsUpdatePut**](#updatesubscriptionapiv1spsubscriptionsupdateput)           | **PUT** /api/v1/sp/subscriptions/update    | Update Subscription      |

# **cancelSubscriptionApiV1SpSubscriptionsCancelPost**

> object cancelSubscriptionApiV1SpSubscriptionsCancelPost(sPSubscriptionCancel)

サブスクリプションをキャンセル Args: data: キャンセルデータ Returns: dict: キャンセル結果 Raises: HTTPException: キャンセルに失敗した場合

### Example

```typescript
import { SpSubscriptionsApi, Configuration, SPSubscriptionCancel } from './api'

const configuration = new Configuration()
const apiInstance = new SpSubscriptionsApi(configuration)

let sPSubscriptionCancel: SPSubscriptionCancel //
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.cancelSubscriptionApiV1SpSubscriptionsCancelPost(
    sPSubscriptionCancel,
    authToken
  )
```

### Parameters

| Name                     | Type                     | Description | Notes                            |
| ------------------------ | ------------------------ | ----------- | -------------------------------- |
| **sPSubscriptionCancel** | **SPSubscriptionCancel** |             |                                  |
| **authToken**            | [**string**]             |             | (optional) defaults to undefined |

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

# **getCurrentSubscriptionApiV1SpSubscriptionsCurrentGet**

> SPSubscriptionResponse getCurrentSubscriptionApiV1SpSubscriptionsCurrentGet()

現在有効なサブスクリプションを取得 Returns: SPSubscriptionResponse: 現在のサブスクリプション情報 Raises: HTTPException: 有効なサブスクリプションがない場合

### Example

```typescript
import { SpSubscriptionsApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new SpSubscriptionsApi(configuration)

let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.getCurrentSubscriptionApiV1SpSubscriptionsCurrentGet(
    authToken
  )
```

### Parameters

| Name          | Type         | Description | Notes                            |
| ------------- | ------------ | ----------- | -------------------------------- |
| **authToken** | [**string**] |             | (optional) defaults to undefined |

### Return type

**SPSubscriptionResponse**

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

# **getSubscriptionHistoryApiV1SpSubscriptionsHistoryGet**

> SPSubscriptionListResponse getSubscriptionHistoryApiV1SpSubscriptionsHistoryGet()

サブスクリプション履歴を取得 Returns: SPSubscriptionListResponse: サブスクリプション履歴

### Example

```typescript
import { SpSubscriptionsApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new SpSubscriptionsApi(configuration)

let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.getSubscriptionHistoryApiV1SpSubscriptionsHistoryGet(
    authToken
  )
```

### Parameters

| Name          | Type         | Description | Notes                            |
| ------------- | ------------ | ----------- | -------------------------------- |
| **authToken** | [**string**] |             | (optional) defaults to undefined |

### Return type

**SPSubscriptionListResponse**

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

# **getSubscriptionPlansApiV1SpSubscriptionsPlansGet**

> SubscriptionPlansResponse getSubscriptionPlansApiV1SpSubscriptionsPlansGet()

利用可能なサブスクリプションプラン一覧を取得 Returns: SubscriptionPlansResponse: プラン一覧と現在のサブスクリプション情報

### Example

```typescript
import { SpSubscriptionsApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new SpSubscriptionsApi(configuration)

let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.getSubscriptionPlansApiV1SpSubscriptionsPlansGet(authToken)
```

### Parameters

| Name          | Type         | Description | Notes                            |
| ------------- | ------------ | ----------- | -------------------------------- |
| **authToken** | [**string**] |             | (optional) defaults to undefined |

### Return type

**SubscriptionPlansResponse**

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

# **purchaseSubscriptionApiV1SpSubscriptionsPurchasePost**

> SPSubscriptionPurchaseResponse purchaseSubscriptionApiV1SpSubscriptionsPurchasePost(sPSubscriptionCreate)

サブスクリプションを購入 Args: data: サブスクリプション作成データ Returns: SPSubscriptionPurchaseResponse: 購入結果 Raises: HTTPException: 購入に失敗した場合

### Example

```typescript
import { SpSubscriptionsApi, Configuration, SPSubscriptionCreate } from './api'

const configuration = new Configuration()
const apiInstance = new SpSubscriptionsApi(configuration)

let sPSubscriptionCreate: SPSubscriptionCreate //
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.purchaseSubscriptionApiV1SpSubscriptionsPurchasePost(
    sPSubscriptionCreate,
    authToken
  )
```

### Parameters

| Name                     | Type                     | Description | Notes                            |
| ------------------------ | ------------------------ | ----------- | -------------------------------- |
| **sPSubscriptionCreate** | **SPSubscriptionCreate** |             |                                  |
| **authToken**            | [**string**]             |             | (optional) defaults to undefined |

### Return type

**SPSubscriptionPurchaseResponse**

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

# **updateSubscriptionApiV1SpSubscriptionsUpdatePut**

> object updateSubscriptionApiV1SpSubscriptionsUpdatePut(sPSubscriptionUpdate)

サブスクリプションを更新（自動更新設定、決済方法など） Args: data: 更新データ Returns: dict: 更新結果 Raises: HTTPException: 更新に失敗した場合

### Example

```typescript
import { SpSubscriptionsApi, Configuration, SPSubscriptionUpdate } from './api'

const configuration = new Configuration()
const apiInstance = new SpSubscriptionsApi(configuration)

let sPSubscriptionUpdate: SPSubscriptionUpdate //
let authToken: string // (optional) (default to undefined)

const { status, data } =
  await apiInstance.updateSubscriptionApiV1SpSubscriptionsUpdatePut(
    sPSubscriptionUpdate,
    authToken
  )
```

### Parameters

| Name                     | Type                     | Description | Notes                            |
| ------------------------ | ------------------------ | ----------- | -------------------------------- |
| **sPSubscriptionUpdate** | **SPSubscriptionUpdate** |             |                                  |
| **authToken**            | [**string**]             |             | (optional) defaults to undefined |

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
