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
import type { CharacterStats } from './character-stats';
// May contain unused imports in some cases
// @ts-ignore
import type { Skill } from './skill';

/**
 * キャラクタースキーマ（レスポンス用）
 * @export
 * @interface Character
 */
export interface Character {
    /**
     * キャラクター名
     * @type {string}
     * @memberof Character
     */
    'name': string;
    /**
     * 
     * @type {string}
     * @memberof Character
     */
    'description'?: string | null;
    /**
     * 
     * @type {string}
     * @memberof Character
     */
    'appearance'?: string | null;
    /**
     * 
     * @type {string}
     * @memberof Character
     */
    'personality'?: string | null;
    /**
     * 現在地
     * @type {string}
     * @memberof Character
     */
    'location'?: string;
    /**
     * 
     * @type {string}
     * @memberof Character
     */
    'id': string;
    /**
     * 
     * @type {string}
     * @memberof Character
     */
    'user_id': string;
    /**
     * 
     * @type {CharacterStats}
     * @memberof Character
     */
    'stats'?: CharacterStats | null;
    /**
     * 
     * @type {Array<Skill>}
     * @memberof Character
     */
    'skills'?: Array<Skill>;
    /**
     * 
     * @type {boolean}
     * @memberof Character
     */
    'is_active'?: boolean;
    /**
     * 
     * @type {Date}
     * @memberof Character
     */
    'created_at': Date;
    /**
     * 
     * @type {Date}
     * @memberof Character
     */
    'updated_at': Date;
    /**
     * 
     * @type {Date}
     * @memberof Character
     */
    'last_played_at'?: Date | null;
}

