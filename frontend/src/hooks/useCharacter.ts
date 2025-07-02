import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Character } from '@/api/generated'

export function useCharacter() {
  const query = useQuery({
    queryKey: ['current-character'],
    queryFn: async () => {
      const response = await apiClient.get('/users/me/current-character')
      return response.data as Character
    },
  })

  return {
    currentCharacter: query.data,
    isLoading: query.isLoading,
    error: query.error,
  }
}

export function useCharacterById(characterId: string) {
  const query = useQuery({
    queryKey: ['character', characterId],
    queryFn: async () => {
      const response = await apiClient.get(`/characters/${characterId}`)
      return response.data as Character
    },
    enabled: !!characterId,
  })

  return {
    character: query.data,
    isLoading: query.isLoading,
    error: query.error,
  }
}
