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



/**
 * サブスクリプションステータス
 * @export
 * @enum {string}
 */

export const SubscriptionStatus = {
    Active: 'active',
    Cancelled: 'cancelled',
    Expired: 'expired',
    Pending: 'pending',
    Failed: 'failed'
} as const;

export type SubscriptionStatus = typeof SubscriptionStatus[keyof typeof SubscriptionStatus];



