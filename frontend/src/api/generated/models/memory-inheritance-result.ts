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
 * 記憶継承の結果
 * @export
 * @interface MemoryInheritanceResult
 */
export interface MemoryInheritanceResult {
    /**
     * 継承が成功したかどうか
     * @type {boolean}
     * @memberof MemoryInheritanceResult
     */
    'success': boolean;
    /**
     * 実行された継承タイプ
     * @type {MemoryInheritanceType}
     * @memberof MemoryInheritanceResult
     */
    'inheritance_type': MemoryInheritanceType;
    /**
     * 継承結果の詳細
     * @type {object}
     * @memberof MemoryInheritanceResult
     */
    'result': object;
    /**
     * 消費されたSP
     * @type {number}
     * @memberof MemoryInheritanceResult
     */
    'sp_consumed': number;
    /**
     * 使用された記憶フラグメントのIDリスト
     * @type {Array<string>}
     * @memberof MemoryInheritanceResult
     */
    'fragments_used': Array<string>;
}



