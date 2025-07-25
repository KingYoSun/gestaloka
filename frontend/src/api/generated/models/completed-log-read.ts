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
import type { CompletedLogStatus } from './completed-log-status';

/**
 * 完成ログ読み取りスキーマ
 * @export
 * @interface CompletedLogRead
 */
export interface CompletedLogRead {
    /**
     * ログの名前
     * @type {string}
     * @memberof CompletedLogRead
     */
    'name': string;
    /**
     * 
     * @type {string}
     * @memberof CompletedLogRead
     */
    'title'?: string | null;
    /**
     * ログの説明文
     * @type {string}
     * @memberof CompletedLogRead
     */
    'description': string;
    /**
     * 獲得したスキル
     * @type {Array<string>}
     * @memberof CompletedLogRead
     */
    'skills'?: Array<string>;
    /**
     * 性格特性
     * @type {Array<string>}
     * @memberof CompletedLogRead
     */
    'personality_traits'?: Array<string>;
    /**
     * 行動パターン
     * @type {object}
     * @memberof CompletedLogRead
     */
    'behavior_patterns'?: object;
    /**
     * 
     * @type {string}
     * @memberof CompletedLogRead
     */
    'id': string;
    /**
     * 
     * @type {string}
     * @memberof CompletedLogRead
     */
    'creator_id': string;
    /**
     * 
     * @type {string}
     * @memberof CompletedLogRead
     */
    'core_fragment_id': string;
    /**
     * 
     * @type {number}
     * @memberof CompletedLogRead
     */
    'contamination_level': number;
    /**
     * 
     * @type {CompletedLogStatus}
     * @memberof CompletedLogRead
     */
    'status': CompletedLogStatus;
    /**
     * 
     * @type {Date}
     * @memberof CompletedLogRead
     */
    'created_at': Date;
    /**
     * 
     * @type {Date}
     * @memberof CompletedLogRead
     */
    'completed_at': Date | null;
}



