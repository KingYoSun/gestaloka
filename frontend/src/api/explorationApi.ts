/**
 * 探索システム API クライアント
 */

import { apiClient } from '@/lib/api-client';
import { requestWithTransform } from '@/lib/api-transform';
import { 
  LocationResponse, 
  AvailableLocationsResponse,
  MoveRequest,
  MoveResponse,
  ExplorationAreaResponse,
  ExploreRequest,
  ExploreResponse,
} from '@/api/generated';

export const explorationApi = {
  /**
   * 全ての発見済み場所を取得
   */
  getAllLocations: () => 
    requestWithTransform(() => 
      apiClient.getApiV1ExplorationLocations()
    ) as Promise<LocationResponse[]>,

  /**
   * 現在地の情報を取得
   */
  getCurrentLocation: (characterId: string) =>
    requestWithTransform(() => 
      apiClient.getApiV1ExplorationCharacterIdCurrentLocation({ characterId })
    ) as Promise<LocationResponse>,

  /**
   * 現在地から移動可能な場所を取得
   */
  getAvailableLocations: (characterId: string) =>
    requestWithTransform(() => 
      apiClient.getApiV1ExplorationCharacterIdAvailableLocations({ characterId })
    ) as Promise<AvailableLocationsResponse>,

  /**
   * 別の場所へ移動
   */
  moveToLocation: (characterId: string, data: MoveRequest) =>
    requestWithTransform(() => 
      apiClient.postApiV1ExplorationCharacterIdMove({ 
        characterId, 
        requestBody: data 
      })
    ) as Promise<MoveResponse>,

  /**
   * 現在地の探索可能エリアを取得
   */
  getExplorationAreas: (characterId: string) =>
    requestWithTransform(() => 
      apiClient.getApiV1ExplorationCharacterIdAreas({ characterId })
    ) as Promise<ExplorationAreaResponse[]>,

  /**
   * エリアを探索
   */
  exploreArea: (characterId: string, data: ExploreRequest) =>
    requestWithTransform(() => 
      apiClient.postApiV1ExplorationCharacterIdExplore({ 
        characterId, 
        requestBody: data 
      })
    ) as Promise<ExploreResponse>,
};