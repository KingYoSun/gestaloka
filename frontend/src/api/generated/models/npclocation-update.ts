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
 * NPC位置更新
 * @export
 * @interface NPCLocationUpdate
 */
export interface NPCLocationUpdate {
    /**
     * 
     * @type {string}
     * @memberof NPCLocationUpdate
     */
    'npc_id': string;
    /**
     * 
     * @type {string}
     * @memberof NPCLocationUpdate
     */
    'new_location': string;
    /**
     * 
     * @type {string}
     * @memberof NPCLocationUpdate
     */
    'reason'?: string | null;
}

