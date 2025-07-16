/**
 * キャラクター関連のReact Query hooks（Zustandストア統合版）
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { charactersApi } from '@/lib/api'
import { Character, CharacterCreate } from '@/api/generated/models'
import { useCharacterStore } from '@/stores/characterStore'
import { useToast } from '@/hooks/useToast'

/**
 * キャラクター一覧を取得（Zustandストア統合）
 */
export function useCharacters() {
  const setCharacters = useCharacterStore(state => state.setCharacters)
  const setLoading = useCharacterStore(state => state.setLoading)
  const setError = useCharacterStore(state => state.setError)
  const clearError = useCharacterStore(state => state.clearError)

  const query = useQuery({
    queryKey: ['characters'],
    queryFn: () => charactersApi.getUserCharactersApiV1CharactersGet(),
    staleTime: 1000 * 60 * 5, // 5分間キャッシュ
  })

  // ストアとの同期
  useEffect(() => {
    setLoading(query.isLoading)

    if (query.data) {
      setCharacters(query.data.data as Character[])
      clearError()
    }

    if (query.error) {
      setError(
        query.error instanceof Error
          ? query.error.message
          : 'エラーが発生しました'
      )
    }
  }, [
    query.data,
    query.isLoading,
    query.error,
    setCharacters,
    setLoading,
    setError,
    clearError,
  ])

  return query
}

/**
 * 特定のキャラクターを取得
 */
export function useCharacter(characterId: string | undefined) {
  return useQuery({
    queryKey: ['characters', characterId],
    queryFn: () => charactersApi.getCharacterApiV1CharactersCharacterIdGet({ characterId: characterId! }),
    enabled: !!characterId,
  })
}

/**
 * キャラクター作成（Zustandストア統合）
 */
export function useCreateCharacter() {
  const queryClient = useQueryClient()
  const addCharacter = useCharacterStore(state => state.addCharacter)
  const { toast } = useToast()

  return useMutation({
    mutationFn: (data: CharacterCreate) =>
      charactersApi.createCharacterApiV1CharactersPost(data),
    onSuccess: response => {
      // ストアに新しいキャラクターを追加
      addCharacter(response.data)

      // キャラクター一覧のキャッシュを更新
      queryClient.invalidateQueries({ queryKey: ['characters'] })

      toast({
        title: 'キャラクター作成成功',
        description: `${response.data.name}を作成しました`,
        variant: 'success',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'エラー',
        description: error.message || 'キャラクター作成に失敗しました',
        variant: 'destructive',
      })
    },
  })
}

/**
 * キャラクター更新（Zustandストア統合）
 */
export function useUpdateCharacter() {
  const queryClient = useQueryClient()
  const updateCharacter = useCharacterStore(state => state.updateCharacter)
  const { toast } = useToast()

  return useMutation({
    mutationFn: ({
      characterId,
      updates,
    }: {
      characterId: string
      updates: Partial<CharacterCreate>
    }) => charactersApi.updateCharacterApiV1CharactersCharacterIdPut({ characterId, characterUpdate: updates }),
    onSuccess: response => {
      // ストアでキャラクター情報を更新
      updateCharacter(response.data.id, response.data)

      // 個別のキャラクターとリストのキャッシュを更新
      queryClient.invalidateQueries({ queryKey: ['characters'] })
      queryClient.invalidateQueries({
        queryKey: ['characters', response.data.id],
      })

      toast({
        title: '更新成功',
        description: 'キャラクター情報を更新しました',
        variant: 'success',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'エラー',
        description: error.message || '更新に失敗しました',
        variant: 'destructive',
      })
    },
  })
}

/**
 * キャラクター削除（Zustandストア統合）
 */
export function useDeleteCharacter() {
  const queryClient = useQueryClient()
  const removeCharacter = useCharacterStore(state => state.removeCharacter)
  const { toast } = useToast()

  return useMutation({
    mutationFn: (characterId: string) => charactersApi.deleteCharacterApiV1CharactersCharacterIdDelete({ characterId }),
    onSuccess: (_, characterId) => {
      // ストアからキャラクターを削除
      removeCharacter(characterId)

      // キャラクター一覧のキャッシュを更新
      queryClient.invalidateQueries({ queryKey: ['characters'] })

      toast({
        title: '削除成功',
        description: 'キャラクターを削除しました',
        variant: 'success',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'エラー',
        description: error.message || '削除に失敗しました',
        variant: 'destructive',
      })
    },
  })
}

/**
 * キャラクターをアクティブにする（Zustandストア統合）
 */
export function useActivateCharacter() {
  const queryClient = useQueryClient()
  const setActiveCharacter = useCharacterStore(
    state => state.setActiveCharacter
  )
  const { toast } = useToast()

  return useMutation({
    mutationFn: (characterId: string) =>
      charactersApi.activateCharacterApiV1CharactersCharacterIdActivatePost({ characterId }),
    onSuccess: response => {
      // ストアでアクティブキャラクターを設定
      setActiveCharacter(response.data.id)

      // キャラクター一覧のキャッシュを更新
      queryClient.invalidateQueries({ queryKey: ['characters'] })

      toast({
        title: 'キャラクター選択',
        description: `${response.data.name}を選択しました`,
        variant: 'success',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'エラー',
        description: error.message || 'キャラクターの選択に失敗しました',
        variant: 'destructive',
      })
    },
  })
}

/**
 * キャラクターの選択を解除する（Zustandストア統合）
 */
export function useDeactivateCharacter() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const setActiveCharacter = useCharacterStore(
    state => state.setActiveCharacter
  )

  return useMutation({
    mutationFn: () => {
      // 選択解除はローカルのみで処理（APIコールなし）
      return Promise.resolve()
    },
    onSuccess: () => {
      // ストアでアクティブキャラクターをクリア
      setActiveCharacter(null)

      // キャラクター一覧のキャッシュを更新
      queryClient.invalidateQueries({ queryKey: ['characters'] })

      toast({
        title: '選択解除',
        description: 'キャラクターの選択を解除しました',
        variant: 'success',
      })
    },
  })
}
