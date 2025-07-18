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
import type { DispatchObjectiveType } from './dispatch-objective-type';
// May contain unused imports in some cases
// @ts-ignore
import type { DispatchStatus } from './dispatch-status';

/**
 * 派遣情報の読み取り
 * @export
 * @interface DispatchRead
 */
export interface DispatchRead {
    /**
     * 派遣する完成ログのID
     * @type {string}
     * @memberof DispatchRead
     */
    'completed_log_id': string;
    /**
     * 派遣するキャラクターのID
     * @type {string}
     * @memberof DispatchRead
     */
    'dispatcher_id': string;
    /**
     * 派遣目的
     * @type {DispatchObjectiveType}
     * @memberof DispatchRead
     */
    'objective_type': DispatchObjectiveType;
    /**
     * 具体的な目的の説明
     * @type {string}
     * @memberof DispatchRead
     */
    'objective_detail': string;
    /**
     * 初期スポーン地点
     * @type {string}
     * @memberof DispatchRead
     */
    'initial_location': string;
    /**
     * 派遣期間（日）
     * @type {number}
     * @memberof DispatchRead
     */
    'dispatch_duration_days': number;
    /**
     * 
     * @type {string}
     * @memberof DispatchRead
     */
    'id': string;
    /**
     * 消費SP
     * @type {number}
     * @memberof DispatchRead
     */
    'sp_cost': number;
    /**
     * 
     * @type {DispatchStatus}
     * @memberof DispatchRead
     */
    'status': DispatchStatus;
    /**
     * 時系列の活動記録
     * @type {Array<object>}
     * @memberof DispatchRead
     */
    'travel_log': Array<object>;
    /**
     * 収集したアイテム
     * @type {Array<object>}
     * @memberof DispatchRead
     */
    'collected_items': Array<object>;
    /**
     * 発見した場所
     * @type {Array<string>}
     * @memberof DispatchRead
     */
    'discovered_locations': Array<string>;
    /**
     * SP還元量
     * @type {number}
     * @memberof DispatchRead
     */
    'sp_refund_amount': number;
    /**
     * 達成度スコア（0.0-1.0）
     * @type {number}
     * @memberof DispatchRead
     */
    'achievement_score': number;
    /**
     * 
     * @type {Date}
     * @memberof DispatchRead
     */
    'created_at': Date;
    /**
     * 
     * @type {Date}
     * @memberof DispatchRead
     */
    'dispatched_at': Date | null;
    /**
     * 
     * @type {Date}
     * @memberof DispatchRead
     */
    'expected_return_at': Date | null;
    /**
     * 
     * @type {Date}
     * @memberof DispatchRead
     */
    'actual_return_at': Date | null;
}



