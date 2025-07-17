# DispatchApi

All URIs are relative to *http://localhost*

|Method | HTTP request | Description|
|------------- | ------------- | -------------|
|[**createDispatchApiV1DispatchDispatchPost**](#createdispatchapiv1dispatchdispatchpost) | **POST** /api/v1/dispatch/dispatch | Create Dispatch|
|[**getDispatchDetailApiV1DispatchDispatchesDispatchIdGet**](#getdispatchdetailapiv1dispatchdispatchesdispatchidget) | **GET** /api/v1/dispatch/dispatches/{dispatch_id} | Get Dispatch Detail|
|[**getDispatchReportApiV1DispatchDispatchesDispatchIdReportGet**](#getdispatchreportapiv1dispatchdispatchesdispatchidreportget) | **GET** /api/v1/dispatch/dispatches/{dispatch_id}/report | Get Dispatch Report|
|[**getMyDispatchesApiV1DispatchDispatchesGet**](#getmydispatchesapiv1dispatchdispatchesget) | **GET** /api/v1/dispatch/dispatches | Get My Dispatches|
|[**interactWithLogNpcApiV1DispatchEncountersEncounterIdInteractPost**](#interactwithlognpcapiv1dispatchencountersencounteridinteractpost) | **POST** /api/v1/dispatch/encounters/{encounter_id}/interact | Interact With Log Npc|
|[**recallDispatchApiV1DispatchDispatchesDispatchIdRecallPost**](#recalldispatchapiv1dispatchdispatchesdispatchidrecallpost) | **POST** /api/v1/dispatch/dispatches/{dispatch_id}/recall | Recall Dispatch|

# **createDispatchApiV1DispatchDispatchPost**
> DispatchRead createDispatchApiV1DispatchDispatchPost(dispatchCreate)

ログを派遣する  完成ログを指定して、他のプレイヤーの世界に派遣します。 派遣にはSPが必要です。

### Example

```typescript
import {
    DispatchApi,
    Configuration,
    DispatchCreate
} from './api';

const configuration = new Configuration();
const apiInstance = new DispatchApi(configuration);

let dispatchCreate: DispatchCreate; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.createDispatchApiV1DispatchDispatchPost(
    dispatchCreate,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **dispatchCreate** | **DispatchCreate**|  | |
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**DispatchRead**

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

# **getDispatchDetailApiV1DispatchDispatchesDispatchIdGet**
> DispatchWithEncounters getDispatchDetailApiV1DispatchDispatchesDispatchIdGet()

派遣の詳細情報を取得  遭遇記録や活動ログを含む詳細情報を返します。

### Example

```typescript
import {
    DispatchApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new DispatchApi(configuration);

let dispatchId: string; // (default to undefined)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getDispatchDetailApiV1DispatchDispatchesDispatchIdGet(
    dispatchId,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **dispatchId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**DispatchWithEncounters**

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

# **getDispatchReportApiV1DispatchDispatchesDispatchIdReportGet**
> DispatchReportRead getDispatchReportApiV1DispatchDispatchesDispatchIdReportGet()

派遣報告書を取得  派遣が完了した後の詳細な報告書を取得します。

### Example

```typescript
import {
    DispatchApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new DispatchApi(configuration);

let dispatchId: string; // (default to undefined)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getDispatchReportApiV1DispatchDispatchesDispatchIdReportGet(
    dispatchId,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **dispatchId** | [**string**] |  | defaults to undefined|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**DispatchReportRead**

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

# **getMyDispatchesApiV1DispatchDispatchesGet**
> Array<DispatchRead> getMyDispatchesApiV1DispatchDispatchesGet()

自分の派遣一覧を取得

### Example

```typescript
import {
    DispatchApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new DispatchApi(configuration);

let status: DispatchStatus; //フィルタするステータス (optional) (default to undefined)
let skip: number; // (optional) (default to 0)
let limit: number; // (optional) (default to 10)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getMyDispatchesApiV1DispatchDispatchesGet(
    status,
    skip,
    limit,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **status** | **DispatchStatus** | フィルタするステータス | (optional) defaults to undefined|
| **skip** | [**number**] |  | (optional) defaults to 0|
| **limit** | [**number**] |  | (optional) defaults to 10|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**Array<DispatchRead>**

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

# **interactWithLogNpcApiV1DispatchEncountersEncounterIdInteractPost**
> any interactWithLogNpcApiV1DispatchEncountersEncounterIdInteractPost(body)

派遣ログNPCとの相互作用を記録  Args:     encounter_id: 遭遇ID（game_sessionから取得）     interaction_type: 相互作用の種類（talk, trade, help等）     interaction_result: 相互作用の結果（アイテム交換、情報共有等）

### Example

```typescript
import {
    DispatchApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new DispatchApi(configuration);

let encounterId: string; // (default to undefined)
let interactionType: string; // (default to undefined)
let body: object; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.interactWithLogNpcApiV1DispatchEncountersEncounterIdInteractPost(
    encounterId,
    interactionType,
    body,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **body** | **object**|  | |
| **encounterId** | [**string**] |  | defaults to undefined|
| **interactionType** | [**string**] |  | defaults to undefined|
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

# **recallDispatchApiV1DispatchDispatchesDispatchIdRecallPost**
> any recallDispatchApiV1DispatchDispatchesDispatchIdRecallPost()

派遣を緊急召還する  派遣中のログを即座に帰還させます。 追加のSPが必要です。

### Example

```typescript
import {
    DispatchApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new DispatchApi(configuration);

let dispatchId: string; // (default to undefined)
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.recallDispatchApiV1DispatchDispatchesDispatchIdRecallPost(
    dispatchId,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **dispatchId** | [**string**] |  | defaults to undefined|
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

