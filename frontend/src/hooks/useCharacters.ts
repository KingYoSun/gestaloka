/**
 * キャラクター関連のReact Query hooks（Zustandストア統合版）
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { apiClient } from '@/api/client'
import { CharacterCreationForm } from '@/types'
import { useCharacterStore } from '@/stores/characterStore'
import { showSuccessToast, showErrorToast } from '@/utils/toast'

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
    queryFn: () => apiClient.getCharacters(),
    staleTime: 1000 * 60 * 5, // 5分間キャッシュ
  })

  // ストアとの同期
  useEffect(() => {
    setLoading(query.isLoading)

    if (query.data) {
      setCharacters(query.data)
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
    queryFn: () => apiClient.getCharacter(characterId!),
    enabled: !!characterId,
  })
}

/**
 * キャラクター作成（Zustandストア統合）
 */
export function useCreateCharacter() {
  const queryClient = useQueryClient()
  const addCharacter = useCharacterStore(state => state.addCharacter)

  return useMutation({
    mutationFn: (data: CharacterCreationForm) =>
      apiClient.createCharacter(data),
    onSuccess: newCharacter => {
      // ストアに新しいキャラクターを追加
      addCharacter(newCharacter)

      // キャラクター一覧のキャッシュを更新
      queryClient.invalidateQueries({ queryKey: ['characters'] })

      showSuccessToast(
        'キャラクター作成成功',
        `${newCharacter.name}を作成しました`
      )
    },
    onError: (error: Error) => {
      showErrorToast(error, 'キャラクター作成に失敗しました')
    },
  })
}

/**
 * キャラクター更新（Zustandストア統合）
 */
export function useUpdateCharacter() {
  const queryClient = useQueryClient()
  const updateCharacter = useCharacterStore(state => state.updateCharacter)

  return useMutation({
    mutationFn: ({
      characterId,
      updates,
    }: {
      characterId: string
      updates: Partial<CharacterCreationForm>
    }) => apiClient.updateCharacter(characterId, updates),
    onSuccess: updatedCharacter => {
      // ストアでキャラクター情報を更新
      updateCharacter(updatedCharacter.id, updatedCharacter)

      // 個別のキャラクターとリストのキャッシュを更新
      queryClient.invalidateQueries({ queryKey: ['characters'] })
      queryClient.invalidateQueries({
        queryKey: ['characters', updatedCharacter.id],
      })

      showSuccessToast('更新成功', 'キャラクター情報を更新しました')
    },
    onError: (error: Error) => {
      showErrorToast(error, '更新に失敗しました')
    },
  })
}

/**
 * キャラクター削除（Zustandストア統合）
 */
export function useDeleteCharacter() {
  const queryClient = useQueryClient()
  const removeCharacter = useCharacterStore(state => state.removeCharacter)

  return useMutation({
    mutationFn: (characterId: string) => apiClient.deleteCharacter(characterId),
    onSuccess: (_, characterId) => {
      // ストアからキャラクターを削除
      removeCharacter(characterId)

      // キャラクター一覧のキャッシュを更新
      queryClient.invalidateQueries({ queryKey: ['characters'] })

      showSuccessToast('削除成功', 'キャラクターを削除しました')
    },
    onError: (error: Error) => {
      showErrorToast(error, '削除に失敗しました')
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

  return useMutation({
    mutationFn: (characterId: string) =>
      apiClient.activateCharacter(characterId),
    onSuccess: activatedCharacter => {
      // ストアでアクティブキャラクターを設定
      setActiveCharacter(activatedCharacter.id)

      // キャラクター一覧のキャッシュを更新
      queryClient.invalidateQueries({ queryKey: ['characters'] })

      showSuccessToast(
        'キャラクター選択',
        `${activatedCharacter.name}を選択しました`
      )
    },
    onError: (error: Error) => {
      showErrorToast(error, 'キャラクターの選択に失敗しました')
    },
  })
}

/**
 * キャラクターの選択を解除する（Zustandストア統合）
 */
export function useDeactivateCharacter() {
  const queryClient = useQueryClient()
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

      showSuccessToast('選択解除', 'キャラクターの選択を解除しました')
    },
  })
}
