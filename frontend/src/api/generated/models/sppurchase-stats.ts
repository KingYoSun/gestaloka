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
 * SP購入統計
 * @export
 * @interface SPPurchaseStats
 */
export interface SPPurchaseStats {
    /**
     * 総購入回数
     * @type {number}
     * @memberof SPPurchaseStats
     */
    'total_purchases': number;
    /**
     * 総購入SP
     * @type {number}
     * @memberof SPPurchaseStats
     */
    'total_sp_purchased': number;
    /**
     * 総支払額（円）
     * @type {number}
     * @memberof SPPurchaseStats
     */
    'total_spent_jpy': number;
}

