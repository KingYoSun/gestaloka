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
import type { EmotionalValence } from './emotional-valence';
// May contain unused imports in some cases
// @ts-ignore
import type { LogFragmentRarity } from './log-fragment-rarity';

/**
 * ログフラグメント読み取りスキーマ
 * @export
 * @interface LogFragmentRead
 */
export interface LogFragmentRead {
    /**
     * 行動の詳細な記述
     * @type {string}
     * @memberof LogFragmentRead
     */
    'action_description': string;
    /**
     * キーワード
     * @type {Array<string>}
     * @memberof LogFragmentRead
     */
    'keywords'?: Array<string>;
    /**
     * 
     * @type {EmotionalValence}
     * @memberof LogFragmentRead
     */
    'emotional_valence'?: EmotionalValence;
    /**
     * レアリティ
     * @type {LogFragmentRarity}
     * @memberof LogFragmentRead
     */
    'rarity'?: LogFragmentRarity;
    /**
     * 重要度スコア
     * @type {number}
     * @memberof LogFragmentRead
     */
    'importance_score'?: number;
    /**
     * 行動時の文脈情報
     * @type {object}
     * @memberof LogFragmentRead
     */
    'context_data'?: object;
    /**
     * 
     * @type {string}
     * @memberof LogFragmentRead
     */
    'id': string;
    /**
     * 
     * @type {string}
     * @memberof LogFragmentRead
     */
    'character_id': string;
    /**
     * 
     * @type {string}
     * @memberof LogFragmentRead
     */
    'session_id': string;
    /**
     * 
     * @type {Date}
     * @memberof LogFragmentRead
     */
    'created_at': Date;
}



