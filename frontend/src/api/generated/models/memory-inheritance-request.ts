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


// May contain unused imports in some cases
// @ts-ignore
import type { MemoryInheritanceType } from './memory-inheritance-type';

/**
 * 記憶継承リクエスト
 * @export
 * @interface MemoryInheritanceRequest
 */
export interface MemoryInheritanceRequest {
    /**
     * 組み合わせる記憶フラグメントのIDリスト（最低2つ）
     * @type {Array<string>}
     * @memberof MemoryInheritanceRequest
     */
    'fragment_ids': Array<string>;
    /**
     * 継承タイプ
     * @type {MemoryInheritanceType}
     * @memberof MemoryInheritanceRequest
     */
    'inheritance_type': MemoryInheritanceType;
}



