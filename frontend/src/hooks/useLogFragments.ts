import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { LogFragment } from '@/api/generated'

export function useLogFragments(characterId: string) {
  const query = useQuery({
    queryKey: ['log-fragments', characterId],
    queryFn: async () => {
      return await apiClient.get<LogFragment[]>(
        `/characters/${characterId}/log-fragments`
      )
    },
    enabled: !!characterId,
  })

  return {
    fragments: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}
