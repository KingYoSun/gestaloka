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
  try {
    const response = await apiClient.get<CharacterTitle[]>('/titles/')
    return response
  } catch (error) {
    console.error('Failed to fetch titles:', error)
    throw error
  }
}

/**
 * Get the currently equipped title
 */
export const getEquippedTitle = async (): Promise<CharacterTitle | null> => {
  const response = await apiClient.get<CharacterTitle | null>(
    '/titles/equipped'
  )
  return response
}

/**
 * Equip a specific title
 */
export const equipTitle = async (titleId: string): Promise<CharacterTitle> => {
  const response = await apiClient.put<CharacterTitle>(
    `/titles/${titleId}/equip`
  )
  return response
}

/**
 * Unequip all titles
 */
export const unequipAllTitles = async (): Promise<EquipTitleResponse> => {
  const response = await apiClient.put<EquipTitleResponse>('/titles/unequip')
  return response
}
