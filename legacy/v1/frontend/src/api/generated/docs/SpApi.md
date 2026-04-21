# SpApi

All URIs are relative to *http://localhost*

|Method | HTTP request | Description|
|------------- | ------------- | -------------|
|[**cancelPurchaseApiV1SpPurchasesPurchaseIdCancelPost**](#cancelpurchaseapiv1sppurchasespurchaseidcancelpost) | **POST** /api/v1/sp/purchases/{purchase_id}/cancel | Cancel Purchase|
|[**consumeSpApiV1SpConsumePost**](#consumespapiv1spconsumepost) | **POST** /api/v1/sp/consume | Consume Sp|
|[**createPurchaseApiV1SpPurchasePost**](#createpurchaseapiv1sppurchasepost) | **POST** /api/v1/sp/purchase | Create Purchase|
|[**createStripeCheckoutApiV1SpStripeCheckoutPost**](#createstripecheckoutapiv1spstripecheckoutpost) | **POST** /api/v1/sp/stripe/checkout | Create Stripe Checkout|
|[**getPurchaseDetailApiV1SpPurchasesPurchaseIdGet**](#getpurchasedetailapiv1sppurchasespurchaseidget) | **GET** /api/v1/sp/purchases/{purchase_id} | Get Purchase Detail|
|[**getPurchaseStatsApiV1SpPurchaseStatsGet**](#getpurchasestatsapiv1sppurchasestatsget) | **GET** /api/v1/sp/purchase-stats | Get Purchase Stats|
|[**getSpBalanceApiV1SpBalanceGet**](#getspbalanceapiv1spbalanceget) | **GET** /api/v1/sp/balance | Get Sp Balance|
|[**getSpBalanceSummaryApiV1SpBalanceSummaryGet**](#getspbalancesummaryapiv1spbalancesummaryget) | **GET** /api/v1/sp/balance/summary | Get Sp Balance Summary|
|[**getSpPlansApiV1SpPlansGet**](#getspplansapiv1spplansget) | **GET** /api/v1/sp/plans | Get Sp Plans|
|[**getTransactionDetailApiV1SpTransactionsTransactionIdGet**](#gettransactiondetailapiv1sptransactionstransactionidget) | **GET** /api/v1/sp/transactions/{transaction_id} | Get Transaction Detail|
|[**getTransactionHistoryApiV1SpTransactionsGet**](#gettransactionhistoryapiv1sptransactionsget) | **GET** /api/v1/sp/transactions | Get Transaction History|
|[**getUserPurchasesApiV1SpPurchasesGet**](#getuserpurchasesapiv1sppurchasesget) | **GET** /api/v1/sp/purchases | Get User Purchases|
|[**processDailyRecoveryApiV1SpDailyRecoveryPost**](#processdailyrecoveryapiv1spdailyrecoverypost) | **POST** /api/v1/sp/daily-recovery | Process Daily Recovery|

# **cancelPurchaseApiV1SpPurchasesPurchaseIdCancelPost**
> SPPurchaseDetail cancelPurchaseApiV1SpPurchasesPurchaseIdCancelPost()

購入をキャンセル  - PENDING または PROCESSING 状態の購入のみキャンセル可能

### Example

```typescript
import {
    SpApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new SpApi(configuration);

let purchaseId: string; // (default to undefined)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.cancelPurchaseApiV1SpPurchasesPurchaseIdCancelPost(
    purchaseId,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **purchaseId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**SPPurchaseDetail**

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

# **consumeSpApiV1SpConsumePost**
> SPConsumeResponse consumeSpApiV1SpConsumePost(sPConsumeRequest)

SPを消費  Args:     request: SP消費リクエスト  Returns:     SPConsumeResponse: 消費結果  Raises:     HTTPException: SP不足または処理エラー

### Example

```typescript
import {
    SpApi,
    Configuration,
    SPConsumeRequest
} from './api';

const configuration = new Configuration();
const apiInstance = new SpApi(configuration);

let sPConsumeRequest: SPConsumeRequest; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.consumeSpApiV1SpConsumePost(
    sPConsumeRequest,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **sPConsumeRequest** | **SPConsumeRequest**|  | |
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**SPConsumeResponse**

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

# **createPurchaseApiV1SpPurchasePost**
> PurchaseResponse createPurchaseApiV1SpPurchasePost(purchaseRequest)

SP購入申請を作成  - テストモードの場合はtest_reasonが必須です - 自動承認が有効な場合は即座にSPが付与されます

### Example

```typescript
import {
    SpApi,
    Configuration,
    PurchaseRequest
} from './api';

const configuration = new Configuration();
const apiInstance = new SpApi(configuration);

let purchaseRequest: PurchaseRequest; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.createPurchaseApiV1SpPurchasePost(
    purchaseRequest,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **purchaseRequest** | **PurchaseRequest**|  | |
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**PurchaseResponse**

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

# **createStripeCheckoutApiV1SpStripeCheckoutPost**
> StripeCheckoutResponse createStripeCheckoutApiV1SpStripeCheckoutPost(stripeCheckoutRequest)

Stripe チェックアウトセッションを作成  - 本番モードでのみ利用可能 - 成功時にはStripeのチェックアウトページへリダイレクトするURLが返されます

### Example

```typescript
import {
    SpApi,
    Configuration,
    StripeCheckoutRequest
} from './api';

const configuration = new Configuration();
const apiInstance = new SpApi(configuration);

let stripeCheckoutRequest: StripeCheckoutRequest; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.createStripeCheckoutApiV1SpStripeCheckoutPost(
    stripeCheckoutRequest,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **stripeCheckoutRequest** | **StripeCheckoutRequest**|  | |
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**StripeCheckoutResponse**

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

# **getPurchaseDetailApiV1SpPurchasesPurchaseIdGet**
> SPPurchaseDetail getPurchaseDetailApiV1SpPurchasesPurchaseIdGet()

購入詳細を取得  - 自分の購入のみ取得可能です

### Example

```typescript
import {
    SpApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new SpApi(configuration);

let purchaseId: string; // (default to undefined)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getPurchaseDetailApiV1SpPurchasesPurchaseIdGet(
    purchaseId,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **purchaseId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**SPPurchaseDetail**

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

# **getPurchaseStatsApiV1SpPurchaseStatsGet**
> SPPurchaseStats getPurchaseStatsApiV1SpPurchaseStatsGet()

ユーザーの購入統計を取得  - 完了した購入のみが集計対象です

### Example

```typescript
import {
    SpApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new SpApi(configuration);

let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getPurchaseStatsApiV1SpPurchaseStatsGet(
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**SPPurchaseStats**

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

# **getSpBalanceApiV1SpBalanceGet**
> PlayerSPRead getSpBalanceApiV1SpBalanceGet()

現在のSP残高と詳細情報を取得  Returns:     PlayerSPRead: SP残高の詳細情報

### Example

```typescript
import {
    SpApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new SpApi(configuration);

let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getSpBalanceApiV1SpBalanceGet(
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**PlayerSPRead**

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

# **getSpBalanceSummaryApiV1SpBalanceSummaryGet**
> PlayerSPSummary getSpBalanceSummaryApiV1SpBalanceSummaryGet()

SP残高の概要を取得（軽量版）  Returns:     PlayerSPSummary: SP残高の概要

### Example

```typescript
import {
    SpApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new SpApi(configuration);

let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getSpBalanceSummaryApiV1SpBalanceSummaryGet(
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**PlayerSPSummary**

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

# **getSpPlansApiV1SpPlansGet**
> SPPlanResponse getSpPlansApiV1SpPlansGet()

SP購入プラン一覧を取得  - 現在利用可能な全てのプランを返します - payment_modeで現在の支払いモードを確認できます

### Example

```typescript
import {
    SpApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new SpApi(configuration);

const { status, data } = await apiInstance.getSpPlansApiV1SpPlansGet();
```

### Parameters
This endpoint does not have any parameters.


### Return type

**SPPlanResponse**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Successful Response |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **getTransactionDetailApiV1SpTransactionsTransactionIdGet**
> SPTransactionRead getTransactionDetailApiV1SpTransactionsTransactionIdGet()

特定の取引詳細を取得  Args:     transaction_id: 取引ID  Returns:     SPTransactionRead: 取引詳細  Raises:     HTTPException: 取引が見つからない場合

### Example

```typescript
import {
    SpApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new SpApi(configuration);

let transactionId: string; // (default to undefined)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getTransactionDetailApiV1SpTransactionsTransactionIdGet(
    transactionId,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **transactionId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**SPTransactionRead**

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

# **getTransactionHistoryApiV1SpTransactionsGet**
> Array<SPTransactionRead> getTransactionHistoryApiV1SpTransactionsGet()

SP取引履歴を取得  Args:     transaction_type: 取引種別でフィルター     start_date: 開始日時     end_date: 終了日時     related_entity_type: 関連エンティティ種別     related_entity_id: 関連エンティティID     limit: 取得件数上限     offset: オフセット  Returns:     list[SPTransactionRead]: 取引履歴のリスト

### Example

```typescript
import {
    SpApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new SpApi(configuration);

let transactionType: SPTransactionType; // (optional) (default to undefined)
let startDate: Date; // (optional) (default to undefined)
let endDate: Date; // (optional) (default to undefined)
let relatedEntityType: string; // (optional) (default to undefined)
let relatedEntityId: string; // (optional) (default to undefined)
let limit: number; // (optional) (default to 50)
let offset: number; // (optional) (default to 0)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getTransactionHistoryApiV1SpTransactionsGet(
    transactionType,
    startDate,
    endDate,
    relatedEntityType,
    relatedEntityId,
    limit,
    offset,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **transactionType** | **SPTransactionType** |  | (optional) defaults to undefined|
| **startDate** | [**Date**] |  | (optional) defaults to undefined|
| **endDate** | [**Date**] |  | (optional) defaults to undefined|
| **relatedEntityType** | [**string**] |  | (optional) defaults to undefined|
| **relatedEntityId** | [**string**] |  | (optional) defaults to undefined|
| **limit** | [**number**] |  | (optional) defaults to 50|
| **offset** | [**number**] |  | (optional) defaults to 0|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**Array<SPTransactionRead>**

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

# **getUserPurchasesApiV1SpPurchasesGet**
> SPPurchaseList getUserPurchasesApiV1SpPurchasesGet()

ユーザーの購入履歴を取得  - statusでフィルタリング可能 - 新しい順に返されます

### Example

```typescript
import {
    SpApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new SpApi(configuration);

let status: PurchaseStatus; //フィルタするステータス (optional) (default to undefined)
let limit: number; //取得件数 (optional) (default to 20)
let offset: number; //オフセット (optional) (default to 0)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getUserPurchasesApiV1SpPurchasesGet(
    status,
    limit,
    offset,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **status** | **PurchaseStatus** | フィルタするステータス | (optional) defaults to undefined|
| **limit** | [**number**] | 取得件数 | (optional) defaults to 20|
| **offset** | [**number**] | オフセット | (optional) defaults to 0|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**SPPurchaseList**

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

# **processDailyRecoveryApiV1SpDailyRecoveryPost**
> SPDailyRecoveryResponse processDailyRecoveryApiV1SpDailyRecoveryPost()

日次SP回復処理  Returns:     SPDailyRecoveryResponse: 回復結果  Note:     - 1日1回のみ実行可能     - 連続ログインボーナスも同時に処理     - サブスクリプションボーナスも適用

### Example

```typescript
import {
    SpApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new SpApi(configuration);

let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.processDailyRecoveryApiV1SpDailyRecoveryPost(
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**SPDailyRecoveryResponse**

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

