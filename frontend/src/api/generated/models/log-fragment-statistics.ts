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
 * ログフラグメントの統計情報
 * @export
 * @interface LogFragmentStatistics
 */
export interface LogFragmentStatistics {
    /**
     * 総フラグメント数
     * @type {number}
     * @memberof LogFragmentStatistics
     */
    'total_fragments': number;
    /**
     * レアリティ別の数
     * @type {{ [key: string]: number; }}
     * @memberof LogFragmentStatistics
     */
    'by_rarity': { [key: string]: number; };
    /**
     * ユニークキーワード数
     * @type {number}
     * @memberof LogFragmentStatistics
     */
    'unique_keywords': number;
}

