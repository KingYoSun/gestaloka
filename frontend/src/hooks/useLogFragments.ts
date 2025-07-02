import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { LogFragment } from '@/api/generated';

export function useLogFragments(characterId: string) {
  const query = useQuery({
    queryKey: ['log-fragments', characterId],
    queryFn: async () => {
      const response = await apiClient.get(`/characters/${characterId}/log-fragments`);
      return response.data as LogFragment[];
    },
    enabled: !!characterId,
  });

  return {
    fragments: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}