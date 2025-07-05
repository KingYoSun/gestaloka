/**
 * Character titles API client and types
 */
import { apiClient } from './client'

export interface CharacterTitle {
  id: string
  character_id: string
  title: string
  description: string
  effects?: Record<string, any>
  is_equipped: boolean
  acquired_at: string
  created_at: string
  updated_at: string
}

export interface EquipTitleResponse {
  message?: string
}

/**
 * Get all titles for the current character
 */
export const getTitles = async (): Promise<CharacterTitle[]> => {
  const response = await apiClient.get<CharacterTitle[]>('/api/v1/titles/')
  return response.data
}

/**
 * Get the currently equipped title
 */
export const getEquippedTitle = async (): Promise<CharacterTitle | null> => {
  const response = await apiClient.get<CharacterTitle | null>('/api/v1/titles/equipped')
  return response.data
}

/**
 * Equip a specific title
 */
export const equipTitle = async (titleId: string): Promise<CharacterTitle> => {
  const response = await apiClient.put<CharacterTitle>(`/api/v1/titles/${titleId}/equip`)
  return response.data
}

/**
 * Unequip all titles
 */
export const unequipAllTitles = async (): Promise<EquipTitleResponse> => {
  const response = await apiClient.put<EquipTitleResponse>('/api/v1/titles/unequip')
  return response.data
}