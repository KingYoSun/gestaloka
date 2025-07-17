# ConfigApi

All URIs are relative to *http://localhost*

|Method | HTTP request | Description|
|------------- | ------------- | -------------|
|[**getCharacterLimitsApiV1ConfigGameCharacterLimitsGet**](#getcharacterlimitsapiv1configgamecharacterlimitsget) | **GET** /api/v1/config/game/character-limits | Get Character Limits|
|[**getGameConfigApiV1ConfigGameGet**](#getgameconfigapiv1configgameget) | **GET** /api/v1/config/game | Get Game Config|
|[**getValidationRulesApiV1ConfigGameValidationRulesGet**](#getvalidationrulesapiv1configgamevalidationrulesget) | **GET** /api/v1/config/game/validation-rules | Get Validation Rules|

# **getCharacterLimitsApiV1ConfigGameCharacterLimitsGet**
> any getCharacterLimitsApiV1ConfigGameCharacterLimitsGet()

キャラクター作成制限の設定を取得  主にキャラクター作成画面で使用される設定値を返します。

### Example

```typescript
import {
    ConfigApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new ConfigApi(configuration);

const { status, data } = await apiInstance.getCharacterLimitsApiV1ConfigGameCharacterLimitsGet();
```

### Parameters
This endpoint does not have any parameters.


### Return type

**any**

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

# **getGameConfigApiV1ConfigGameGet**
> GameConfig getGameConfigApiV1ConfigGameGet()

ゲーム設定を取得  フロントエンドで使用する各種ゲーム設定値を返します。 これにより、設定値の重複を避け、バックエンドを唯一の真実の源とします。

### Example

```typescript
import {
    ConfigApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new ConfigApi(configuration);

const { status, data } = await apiInstance.getGameConfigApiV1ConfigGameGet();
```

### Parameters
This endpoint does not have any parameters.


### Return type

**GameConfig**

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

# **getValidationRulesApiV1ConfigGameValidationRulesGet**
> any getValidationRulesApiV1ConfigGameValidationRulesGet()

バリデーションルールを取得  フロントエンドでのバリデーション実装に使用される 各種フィールドの制限値を返します。

### Example

```typescript
import {
    ConfigApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new ConfigApi(configuration);

const { status, data } = await apiInstance.getValidationRulesApiV1ConfigGameValidationRulesGet();
```

### Parameters
This endpoint does not have any parameters.


### Return type

**any**

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

