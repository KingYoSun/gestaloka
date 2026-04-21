/**
 * Character titles API client and types
 */
import { titlesApi } from '@/lib/api'
import type { CharacterTitleRead } from '@/api/generated/models'

export type { CharacterTitleRead as CharacterTitle }

export interface EquipTitleResponse {
  message?: string
}

/**
 * Get all titles for the current character
 */
export const getTitles = async (): Promise<CharacterTitleRead[]> => {
  try {
    const response = await titlesApi.getCharacterTitlesApiV1TitlesGet()
    return response.data
  } catch (error) {
    console.error('Failed to fetch titles:', error)
    throw error
  }
}

/**
 * Get the currently equipped title
 */
export const getEquippedTitle = async (): Promise<CharacterTitleRead | null> => {
  const response = await titlesApi.getEquippedTitleApiV1TitlesEquippedGet()
  return response.data
}

/**
 * Equip a specific title
 */
export const equipTitle = async (titleId: string): Promise<CharacterTitleRead> => {
  const response = await titlesApi.equipTitleApiV1TitlesTitleIdEquipPut({ titleId })
  return response.data
}

/**
 * Unequip all titles
 */
export const unequipAllTitles = async (): Promise<EquipTitleResponse> => {
  const response = await titlesApi.unequipAllTitlesApiV1TitlesUnequipPut()
  return response.data as EquipTitleResponse
}