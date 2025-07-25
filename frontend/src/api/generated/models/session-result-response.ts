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
 * セッション結果レスポンス
 * @export
 * @interface SessionResultResponse
 */
export interface SessionResultResponse {
    /**
     * 
     * @type {string}
     * @memberof SessionResultResponse
     */
    'id': string;
    /**
     * 
     * @type {string}
     * @memberof SessionResultResponse
     */
    'session_id': string;
    /**
     * GM AIが生成する物語の要約
     * @type {string}
     * @memberof SessionResultResponse
     */
    'story_summary': string;
    /**
     * 重要イベントのリスト
     * @type {Array<string>}
     * @memberof SessionResultResponse
     */
    'key_events': Array<string>;
    /**
     * 獲得経験値
     * @type {number}
     * @memberof SessionResultResponse
     */
    'experience_gained': number;
    /**
     * 向上したスキル（スキル名: 上昇値）
     * @type {{ [key: string]: number; }}
     * @memberof SessionResultResponse
     */
    'skills_improved': { [key: string]: number; };
    /**
     * 獲得アイテム
     * @type {Array<string>}
     * @memberof SessionResultResponse
     */
    'items_acquired': Array<string>;
    /**
     * 次セッションへ渡すコンテキスト
     * @type {string}
     * @memberof SessionResultResponse
     */
    'continuation_context': string;
    /**
     * 未解決のプロット
     * @type {Array<string>}
     * @memberof SessionResultResponse
     */
    'unresolved_plots': Array<string>;
    /**
     * 
     * @type {Date}
     * @memberof SessionResultResponse
     */
    'created_at': Date;
}

