// @ts-nocheck
/* tslint:disable */
/* eslint-disable */
/**
 * GESTALOKA API
 * マルチプレイ・テキストMMO - ゲスタロカ API
 *
 * The version of the OpenAPI document: 0.1.0
 * 
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */


import type { Configuration } from '../configuration';
import type { AxiosPromise, AxiosInstance, RawAxiosRequestConfig } from 'axios';
import globalAxios from 'axios';
// Some imports not used depending on template conditions
// @ts-ignore
import { DUMMY_BASE_URL, assertParamExists, setApiKeyToObject, setBasicAuthToObject, setBearerAuthToObject, setOAuthToObject, setSearchParams, serializeDataIfNeeded, toPathString, createRequestFunction } from '../common';
// @ts-ignore
import { BASE_PATH, COLLECTION_FORMATS, type RequestArgs, BaseAPI, RequiredError, operationServerMap } from '../base';
// @ts-ignore
import type { HTTPValidationError } from '../models';
// @ts-ignore
import type { User } from '../models';
// @ts-ignore
import type { UserUpdate } from '../models';
/**
 * UsersApi - axios parameter creator
 * @export
 */
export const UsersApiAxiosParamCreator = function (configuration?: Configuration) {
    return {
        /**
         * ユーザーアカウント削除
         * @summary Delete User Account
         * @param {string | null} [authToken] 
         * @param {*} [options] Override http request option.
         * @throws {RequiredError}
         */
        deleteUserAccountApiV1UsersProfileDelete: async (authToken?: string | null, options: RawAxiosRequestConfig = {}): Promise<RequestArgs> => {
            const localVarPath = `/api/v1/users/profile`;
            // use dummy base URL string because the URL constructor only accepts absolute URLs.
            const localVarUrlObj = new URL(localVarPath, DUMMY_BASE_URL);
            let baseOptions;
            if (configuration) {
                baseOptions = configuration.baseOptions;
            }

            const localVarRequestOptions = { method: 'DELETE', ...baseOptions, ...options};
            const localVarHeaderParameter = {} as any;
            const localVarQueryParameter = {} as any;

            // authentication OAuth2PasswordBearer required
            // oauth required
            await setOAuthToObject(localVarHeaderParameter, "OAuth2PasswordBearer", [], configuration)


    
            setSearchParams(localVarUrlObj, localVarQueryParameter);
            let headersFromBaseOptions = baseOptions && baseOptions.headers ? baseOptions.headers : {};
            localVarRequestOptions.headers = {...localVarHeaderParameter, ...headersFromBaseOptions, ...options.headers};

            return {
                url: toPathString(localVarUrlObj),
                options: localVarRequestOptions,
            };
        },
        /**
         * ユーザープロフィール取得
         * @summary Get User Profile
         * @param {string | null} [authToken] 
         * @param {*} [options] Override http request option.
         * @throws {RequiredError}
         */
        getUserProfileApiV1UsersProfileGet: async (authToken?: string | null, options: RawAxiosRequestConfig = {}): Promise<RequestArgs> => {
            const localVarPath = `/api/v1/users/profile`;
            // use dummy base URL string because the URL constructor only accepts absolute URLs.
            const localVarUrlObj = new URL(localVarPath, DUMMY_BASE_URL);
            let baseOptions;
            if (configuration) {
                baseOptions = configuration.baseOptions;
            }

            const localVarRequestOptions = { method: 'GET', ...baseOptions, ...options};
            const localVarHeaderParameter = {} as any;
            const localVarQueryParameter = {} as any;

            // authentication OAuth2PasswordBearer required
            // oauth required
            await setOAuthToObject(localVarHeaderParameter, "OAuth2PasswordBearer", [], configuration)


    
            setSearchParams(localVarUrlObj, localVarQueryParameter);
            let headersFromBaseOptions = baseOptions && baseOptions.headers ? baseOptions.headers : {};
            localVarRequestOptions.headers = {...localVarHeaderParameter, ...headersFromBaseOptions, ...options.headers};

            return {
                url: toPathString(localVarUrlObj),
                options: localVarRequestOptions,
            };
        },
        /**
         * ユーザープロフィール更新
         * @summary Update User Profile
         * @param {UserUpdate} userUpdate 
         * @param {string | null} [authToken] 
         * @param {*} [options] Override http request option.
         * @throws {RequiredError}
         */
        updateUserProfileApiV1UsersProfilePut: async (userUpdate: UserUpdate, authToken?: string | null, options: RawAxiosRequestConfig = {}): Promise<RequestArgs> => {
            // verify required parameter 'userUpdate' is not null or undefined
            assertParamExists('updateUserProfileApiV1UsersProfilePut', 'userUpdate', userUpdate)
            const localVarPath = `/api/v1/users/profile`;
            // use dummy base URL string because the URL constructor only accepts absolute URLs.
            const localVarUrlObj = new URL(localVarPath, DUMMY_BASE_URL);
            let baseOptions;
            if (configuration) {
                baseOptions = configuration.baseOptions;
            }

            const localVarRequestOptions = { method: 'PUT', ...baseOptions, ...options};
            const localVarHeaderParameter = {} as any;
            const localVarQueryParameter = {} as any;

            // authentication OAuth2PasswordBearer required
            // oauth required
            await setOAuthToObject(localVarHeaderParameter, "OAuth2PasswordBearer", [], configuration)


    
            localVarHeaderParameter['Content-Type'] = 'application/json';

            setSearchParams(localVarUrlObj, localVarQueryParameter);
            let headersFromBaseOptions = baseOptions && baseOptions.headers ? baseOptions.headers : {};
            localVarRequestOptions.headers = {...localVarHeaderParameter, ...headersFromBaseOptions, ...options.headers};
            localVarRequestOptions.data = serializeDataIfNeeded(userUpdate, localVarRequestOptions, configuration)

            return {
                url: toPathString(localVarUrlObj),
                options: localVarRequestOptions,
            };
        },
    }
};

/**
 * UsersApi - functional programming interface
 * @export
 */
export const UsersApiFp = function(configuration?: Configuration) {
    const localVarAxiosParamCreator = UsersApiAxiosParamCreator(configuration)
    return {
        /**
         * ユーザーアカウント削除
         * @summary Delete User Account
         * @param {string | null} [authToken] 
         * @param {*} [options] Override http request option.
         * @throws {RequiredError}
         */
        async deleteUserAccountApiV1UsersProfileDelete(authToken?: string | null, options?: RawAxiosRequestConfig): Promise<(axios?: AxiosInstance, basePath?: string) => AxiosPromise<any>> {
            const localVarAxiosArgs = await localVarAxiosParamCreator.deleteUserAccountApiV1UsersProfileDelete(authToken, options);
            const localVarOperationServerIndex = configuration?.serverIndex ?? 0;
            const localVarOperationServerBasePath = operationServerMap['UsersApi.deleteUserAccountApiV1UsersProfileDelete']?.[localVarOperationServerIndex]?.url;
            return (axios, basePath) => createRequestFunction(localVarAxiosArgs, globalAxios, BASE_PATH, configuration)(axios, localVarOperationServerBasePath || basePath);
        },
        /**
         * ユーザープロフィール取得
         * @summary Get User Profile
         * @param {string | null} [authToken] 
         * @param {*} [options] Override http request option.
         * @throws {RequiredError}
         */
        async getUserProfileApiV1UsersProfileGet(authToken?: string | null, options?: RawAxiosRequestConfig): Promise<(axios?: AxiosInstance, basePath?: string) => AxiosPromise<User>> {
            const localVarAxiosArgs = await localVarAxiosParamCreator.getUserProfileApiV1UsersProfileGet(authToken, options);
            const localVarOperationServerIndex = configuration?.serverIndex ?? 0;
            const localVarOperationServerBasePath = operationServerMap['UsersApi.getUserProfileApiV1UsersProfileGet']?.[localVarOperationServerIndex]?.url;
            return (axios, basePath) => createRequestFunction(localVarAxiosArgs, globalAxios, BASE_PATH, configuration)(axios, localVarOperationServerBasePath || basePath);
        },
        /**
         * ユーザープロフィール更新
         * @summary Update User Profile
         * @param {UserUpdate} userUpdate 
         * @param {string | null} [authToken] 
         * @param {*} [options] Override http request option.
         * @throws {RequiredError}
         */
        async updateUserProfileApiV1UsersProfilePut(userUpdate: UserUpdate, authToken?: string | null, options?: RawAxiosRequestConfig): Promise<(axios?: AxiosInstance, basePath?: string) => AxiosPromise<User>> {
            const localVarAxiosArgs = await localVarAxiosParamCreator.updateUserProfileApiV1UsersProfilePut(userUpdate, authToken, options);
            const localVarOperationServerIndex = configuration?.serverIndex ?? 0;
            const localVarOperationServerBasePath = operationServerMap['UsersApi.updateUserProfileApiV1UsersProfilePut']?.[localVarOperationServerIndex]?.url;
            return (axios, basePath) => createRequestFunction(localVarAxiosArgs, globalAxios, BASE_PATH, configuration)(axios, localVarOperationServerBasePath || basePath);
        },
    }
};

/**
 * UsersApi - factory interface
 * @export
 */
export const UsersApiFactory = function (configuration?: Configuration, basePath?: string, axios?: AxiosInstance) {
    const localVarFp = UsersApiFp(configuration)
    return {
        /**
         * ユーザーアカウント削除
         * @summary Delete User Account
         * @param {UsersApiDeleteUserAccountApiV1UsersProfileDeleteRequest} requestParameters Request parameters.
         * @param {*} [options] Override http request option.
         * @throws {RequiredError}
         */
        deleteUserAccountApiV1UsersProfileDelete(requestParameters: UsersApiDeleteUserAccountApiV1UsersProfileDeleteRequest = {}, options?: RawAxiosRequestConfig): AxiosPromise<any> {
            return localVarFp.deleteUserAccountApiV1UsersProfileDelete(requestParameters.authToken, options).then((request) => request(axios, basePath));
        },
        /**
         * ユーザープロフィール取得
         * @summary Get User Profile
         * @param {UsersApiGetUserProfileApiV1UsersProfileGetRequest} requestParameters Request parameters.
         * @param {*} [options] Override http request option.
         * @throws {RequiredError}
         */
        getUserProfileApiV1UsersProfileGet(requestParameters: UsersApiGetUserProfileApiV1UsersProfileGetRequest = {}, options?: RawAxiosRequestConfig): AxiosPromise<User> {
            return localVarFp.getUserProfileApiV1UsersProfileGet(requestParameters.authToken, options).then((request) => request(axios, basePath));
        },
        /**
         * ユーザープロフィール更新
         * @summary Update User Profile
         * @param {UsersApiUpdateUserProfileApiV1UsersProfilePutRequest} requestParameters Request parameters.
         * @param {*} [options] Override http request option.
         * @throws {RequiredError}
         */
        updateUserProfileApiV1UsersProfilePut(requestParameters: UsersApiUpdateUserProfileApiV1UsersProfilePutRequest, options?: RawAxiosRequestConfig): AxiosPromise<User> {
            return localVarFp.updateUserProfileApiV1UsersProfilePut(requestParameters.userUpdate, requestParameters.authToken, options).then((request) => request(axios, basePath));
        },
    };
};

/**
 * UsersApi - interface
 * @export
 * @interface UsersApi
 */
export interface UsersApiInterface {
    /**
     * ユーザーアカウント削除
     * @summary Delete User Account
     * @param {UsersApiDeleteUserAccountApiV1UsersProfileDeleteRequest} requestParameters Request parameters.
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     * @memberof UsersApiInterface
     */
    deleteUserAccountApiV1UsersProfileDelete(requestParameters?: UsersApiDeleteUserAccountApiV1UsersProfileDeleteRequest, options?: RawAxiosRequestConfig): AxiosPromise<any>;

    /**
     * ユーザープロフィール取得
     * @summary Get User Profile
     * @param {UsersApiGetUserProfileApiV1UsersProfileGetRequest} requestParameters Request parameters.
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     * @memberof UsersApiInterface
     */
    getUserProfileApiV1UsersProfileGet(requestParameters?: UsersApiGetUserProfileApiV1UsersProfileGetRequest, options?: RawAxiosRequestConfig): AxiosPromise<User>;

    /**
     * ユーザープロフィール更新
     * @summary Update User Profile
     * @param {UsersApiUpdateUserProfileApiV1UsersProfilePutRequest} requestParameters Request parameters.
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     * @memberof UsersApiInterface
     */
    updateUserProfileApiV1UsersProfilePut(requestParameters: UsersApiUpdateUserProfileApiV1UsersProfilePutRequest, options?: RawAxiosRequestConfig): AxiosPromise<User>;

}

/**
 * Request parameters for deleteUserAccountApiV1UsersProfileDelete operation in UsersApi.
 * @export
 * @interface UsersApiDeleteUserAccountApiV1UsersProfileDeleteRequest
 */
export interface UsersApiDeleteUserAccountApiV1UsersProfileDeleteRequest {
    /**
     * 
     * @type {string}
     * @memberof UsersApiDeleteUserAccountApiV1UsersProfileDelete
     */
    readonly authToken?: string | null
}

/**
 * Request parameters for getUserProfileApiV1UsersProfileGet operation in UsersApi.
 * @export
 * @interface UsersApiGetUserProfileApiV1UsersProfileGetRequest
 */
export interface UsersApiGetUserProfileApiV1UsersProfileGetRequest {
    /**
     * 
     * @type {string}
     * @memberof UsersApiGetUserProfileApiV1UsersProfileGet
     */
    readonly authToken?: string | null
}

/**
 * Request parameters for updateUserProfileApiV1UsersProfilePut operation in UsersApi.
 * @export
 * @interface UsersApiUpdateUserProfileApiV1UsersProfilePutRequest
 */
export interface UsersApiUpdateUserProfileApiV1UsersProfilePutRequest {
    /**
     * 
     * @type {UserUpdate}
     * @memberof UsersApiUpdateUserProfileApiV1UsersProfilePut
     */
    readonly userUpdate: UserUpdate

    /**
     * 
     * @type {string}
     * @memberof UsersApiUpdateUserProfileApiV1UsersProfilePut
     */
    readonly authToken?: string | null
}

/**
 * UsersApi - object-oriented interface
 * @export
 * @class UsersApi
 * @extends {BaseAPI}
 */
export class UsersApi extends BaseAPI implements UsersApiInterface {
    /**
     * ユーザーアカウント削除
     * @summary Delete User Account
     * @param {UsersApiDeleteUserAccountApiV1UsersProfileDeleteRequest} requestParameters Request parameters.
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     * @memberof UsersApi
     */
    public deleteUserAccountApiV1UsersProfileDelete(requestParameters: UsersApiDeleteUserAccountApiV1UsersProfileDeleteRequest = {}, options?: RawAxiosRequestConfig) {
        return UsersApiFp(this.configuration).deleteUserAccountApiV1UsersProfileDelete(requestParameters.authToken, options).then((request) => request(this.axios, this.basePath));
    }

    /**
     * ユーザープロフィール取得
     * @summary Get User Profile
     * @param {UsersApiGetUserProfileApiV1UsersProfileGetRequest} requestParameters Request parameters.
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     * @memberof UsersApi
     */
    public getUserProfileApiV1UsersProfileGet(requestParameters: UsersApiGetUserProfileApiV1UsersProfileGetRequest = {}, options?: RawAxiosRequestConfig) {
        return UsersApiFp(this.configuration).getUserProfileApiV1UsersProfileGet(requestParameters.authToken, options).then((request) => request(this.axios, this.basePath));
    }

    /**
     * ユーザープロフィール更新
     * @summary Update User Profile
     * @param {UsersApiUpdateUserProfileApiV1UsersProfilePutRequest} requestParameters Request parameters.
     * @param {*} [options] Override http request option.
     * @throws {RequiredError}
     * @memberof UsersApi
     */
    public updateUserProfileApiV1UsersProfilePut(requestParameters: UsersApiUpdateUserProfileApiV1UsersProfilePutRequest, options?: RawAxiosRequestConfig) {
        return UsersApiFp(this.configuration).updateUserProfileApiV1UsersProfilePut(requestParameters.userUpdate, requestParameters.authToken, options).then((request) => request(this.axios, this.basePath));
    }
}

