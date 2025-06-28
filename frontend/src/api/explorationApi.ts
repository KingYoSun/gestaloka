/**
 * 探索システム API クライアント
 */

import { apiClient } from '@/lib/api-client';
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
    apiClient.get<LocationResponse[]>('/exploration/locations'),

  /**
   * 現在地の情報を取得
   */
  getCurrentLocation: (characterId: string) =>
    apiClient.get<LocationResponse>(`/exploration/${characterId}/current-location`),

  /**
   * 現在地から移動可能な場所を取得
   */
  getAvailableLocations: (characterId: string) =>
    apiClient.get<AvailableLocationsResponse>(`/exploration/${characterId}/available-locations`),

  /**
   * 別の場所へ移動
   */
  moveToLocation: (characterId: string, data: MoveRequest) =>
    apiClient.post<MoveResponse>(`/exploration/${characterId}/move`, data),

  /**
   * 現在地の探索可能エリアを取得
   */
  getExplorationAreas: (characterId: string) =>
    apiClient.get<ExplorationAreaResponse[]>(`/exploration/${characterId}/areas`),

  /**
   * エリアを探索
   */
  exploreArea: (characterId: string, data: ExploreRequest) =>
    apiClient.post<ExploreResponse>(`/exploration/${characterId}/explore`, data),
};