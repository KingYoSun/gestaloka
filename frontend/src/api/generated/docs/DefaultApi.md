# DefaultApi

All URIs are relative to _http://localhost_

| Method                                            | HTTP request     | Description  |
| ------------------------------------------------- | ---------------- | ------------ |
| [**healthCheckHealthGet**](#healthcheckhealthget) | **GET** /health  | Health Check |
| [**metricsMetricsGet**](#metricsmetricsget)       | **GET** /metrics | Metrics      |
| [**rootGet**](#rootget)                           | **GET** /        | Root         |

# **healthCheckHealthGet**

> any healthCheckHealthGet()

ヘルスチェックエンドポイント

### Example

```typescript
import { DefaultApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new DefaultApi(configuration)

const { status, data } = await apiInstance.healthCheckHealthGet()
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

| Status code | Description         | Response headers |
| ----------- | ------------------- | ---------------- |
| **200**     | Successful Response | -                |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **metricsMetricsGet**

> any metricsMetricsGet()

メトリクスエンドポイント（Prometheus形式）

### Example

```typescript
import { DefaultApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new DefaultApi(configuration)

const { status, data } = await apiInstance.metricsMetricsGet()
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

| Status code | Description         | Response headers |
| ----------- | ------------------- | ---------------- |
| **200**     | Successful Response | -                |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **rootGet**

> any rootGet()

ルートエンドポイント

### Example

```typescript
import { DefaultApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new DefaultApi(configuration)

const { status, data } = await apiInstance.rootGet()
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

| Status code | Description         | Response headers |
| ----------- | ------------------- | ---------------- |
| **200**     | Successful Response | -                |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)
