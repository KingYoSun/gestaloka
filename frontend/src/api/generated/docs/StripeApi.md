# StripeApi

All URIs are relative to _http://localhost_

| Method                                                                          | HTTP request                    | Description    |
| ------------------------------------------------------------------------------- | ------------------------------- | -------------- |
| [**stripeWebhookApiV1StripeWebhookPost**](#stripewebhookapiv1stripewebhookpost) | **POST** /api/v1/stripe/webhook | Stripe Webhook |

# **stripeWebhookApiV1StripeWebhookPost**

> any stripeWebhookApiV1StripeWebhookPost()

Stripe Webhookエンドポイント Stripeからの支払い完了通知を受け取り、SP購入を処理します

### Example

```typescript
import { StripeApi, Configuration } from './api'

const configuration = new Configuration()
const apiInstance = new StripeApi(configuration)

const { status, data } = await apiInstance.stripeWebhookApiV1StripeWebhookPost()
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
