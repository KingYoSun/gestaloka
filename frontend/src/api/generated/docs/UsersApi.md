# UsersApi

All URIs are relative to *http://localhost*

|Method | HTTP request | Description|
|------------- | ------------- | -------------|
|[**deleteUserAccountApiV1UsersProfileDelete**](#deleteuseraccountapiv1usersprofiledelete) | **DELETE** /api/v1/users/profile | Delete User Account|
|[**getUserProfileApiV1UsersProfileGet**](#getuserprofileapiv1usersprofileget) | **GET** /api/v1/users/profile | Get User Profile|
|[**updateUserProfileApiV1UsersProfilePut**](#updateuserprofileapiv1usersprofileput) | **PUT** /api/v1/users/profile | Update User Profile|

# **deleteUserAccountApiV1UsersProfileDelete**
> any deleteUserAccountApiV1UsersProfileDelete()

ユーザーアカウント削除

### Example

```typescript
import {
    UsersApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new UsersApi(configuration);

let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.deleteUserAccountApiV1UsersProfileDelete(
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
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

# **getUserProfileApiV1UsersProfileGet**
> User getUserProfileApiV1UsersProfileGet()

ユーザープロフィール取得

### Example

```typescript
import {
    UsersApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new UsersApi(configuration);

let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.getUserProfileApiV1UsersProfileGet(
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**User**

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

# **updateUserProfileApiV1UsersProfilePut**
> User updateUserProfileApiV1UsersProfilePut(userUpdate)

ユーザープロフィール更新

### Example

```typescript
import {
    UsersApi,
    Configuration,
    UserUpdate
} from './api';

const configuration = new Configuration();
const apiInstance = new UsersApi(configuration);

let userUpdate: UserUpdate; //
let authToken: string; // (optional) (default to undefined)

const { status, data } = await apiInstance.updateUserProfileApiV1UsersProfilePut(
    userUpdate,
    authToken
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **userUpdate** | **UserUpdate**|  | |
| **authToken** | [**string**] |  | (optional) defaults to undefined|


### Return type

**User**

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

