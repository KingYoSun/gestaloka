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
 * SP購入パッケージ
 * @export
 * @enum {string}
 */

export const SPPurchasePackage = {
    Small: 'small',
    Medium: 'medium',
    Large: 'large',
    ExtraLarge: 'extra_large',
    Mega: 'mega'
} as const;

export type SPPurchasePackage = typeof SPPurchasePackage[keyof typeof SPPurchasePackage];



