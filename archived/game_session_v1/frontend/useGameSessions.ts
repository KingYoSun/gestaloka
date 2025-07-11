/**
 * ゲームセッション関連のReact Queryフック
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { useGameSessionStore } from '@/stores/gameSessionStore'
import {
  GameSession,
  GameSessionCreate,
  GameSessionListResponse,
  GameActionRequest,
  GameActionResponse,
  SessionData,
  SessionEndingProposal,
  SessionEndingAcceptResponse,
  SessionEndingRejectResponse,
  SessionResultResponse,
} from '@/types'

// ゲームセッション一覧取得
export const useGameSessions = () => {
  return useQuery<GameSessionListResponse>({
    queryKey: ['gameSessions'],
    queryFn: () => apiClient.getGameSessions(),
    staleTime: 5 * 60 * 1000, // 5分間キャッシュ
  })
}

// 特定のゲームセッション取得
export const useGameSession = (sessionId: string | undefined) => {
  return useQuery<GameSession>({
    queryKey: ['gameSession', sessionId],
    queryFn: () => apiClient.getGameSession(sessionId!),
    enabled: !!sessionId,
    staleTime: 2 * 60 * 1000, // 2分間キャッシュ
  })
}

// ゲームセッション作成
export const useCreateGameSession = () => {
  const queryClient = useQueryClient()
  const { setActiveSession } = useGameSessionStore()

  return useMutation<GameSession, Error, GameSessionCreate>({
    mutationFn: (sessionData: GameSessionCreate) =>
      apiClient.createGameSession(sessionData),
    onSuccess: newSession => {
      // キャッシュを更新
      queryClient.invalidateQueries({ queryKey: ['gameSessions'] })
      queryClient.setQueryData(['gameSession', newSession.id], newSession)

      // ストアにアクティブセッションを設定
      setActiveSession(newSession)
    },
  })
}

// ゲームセッション更新
export const useUpdateGameSession = () => {
  const queryClient = useQueryClient()
  const { setActiveSession } = useGameSessionStore()

  return useMutation<
    GameSession,
    Error,
    {
      sessionId: string
      updates: { currentScene?: string; sessionData?: SessionData }
    }
  >({
    mutationFn: ({ sessionId, updates }) =>
      apiClient.updateGameSession(sessionId, updates),
    onSuccess: updatedSession => {
      // キャッシュを更新
      queryClient.setQueryData(
        ['gameSession', updatedSession.id],
        updatedSession
      )
      queryClient.invalidateQueries({ queryKey: ['gameSessions'] })

      // アクティブセッションの場合はストアも更新
      const { activeSession } = useGameSessionStore.getState()
      if (activeSession?.id === updatedSession.id) {
        setActiveSession(updatedSession)
      }
    },
  })
}

// ゲームセッション終了
export const useEndGameSession = () => {
  const queryClient = useQueryClient()
  const { clearActiveSession, activeSession } = useGameSessionStore()

  return useMutation<GameSession, Error, string>({
    mutationFn: (sessionId: string) => apiClient.endGameSession(sessionId),
    onSuccess: endedSession => {
      // キャッシュを更新
      queryClient.setQueryData(['gameSession', endedSession.id], endedSession)
      queryClient.invalidateQueries({ queryKey: ['gameSessions'] })

      // アクティブセッションの場合はクリア
      if (activeSession?.id === endedSession.id) {
        clearActiveSession()
      }
    },
  })
}

// ゲームアクション実行
export const useExecuteGameAction = () => {
  const queryClient = useQueryClient()
  const { addGameMessage } = useGameSessionStore()

  return useMutation<
    GameActionResponse,
    Error,
    { sessionId: string; action: GameActionRequest }
  >({
    mutationFn: ({ sessionId, action }) =>
      apiClient.executeGameAction(sessionId, action),
    onSuccess: (response, { sessionId }) => {
      // セッション情報を再取得（シーンが変更された可能性があるため）
      queryClient.invalidateQueries({ queryKey: ['gameSession', sessionId] })

      // ストアにメッセージを追加
      addGameMessage({
        id: `action-${Date.now()}`,
        sessionId: response.sessionId,
        type: 'user',
        content: '',
        timestamp: new Date().toISOString(),
      })

      addGameMessage({
        id: `response-${Date.now()}`,
        sessionId: response.sessionId,
        type: 'gm',
        content: response.actionResult,
        metadata: {
          newScene: response.newScene,
          choices: response.choices,
          characterStatus: response.characterStatus,
        },
        timestamp: new Date().toISOString(),
      })
    },
  })
}

// セッション終了提案を取得
export const useSessionEndingProposal = (sessionId: string | undefined) => {
  return useQuery<SessionEndingProposal>({
    queryKey: ['sessionEndingProposal', sessionId],
    queryFn: () => apiClient.getSessionEndingProposal(sessionId!),
    enabled: !!sessionId,
    staleTime: 30 * 1000, // 30秒間キャッシュ
  })
}

// セッション終了を承認
export const useAcceptSessionEnding = () => {
  const queryClient = useQueryClient()
  const { clearActiveSession } = useGameSessionStore()

  return useMutation<SessionEndingAcceptResponse, Error, string>({
    mutationFn: (sessionId: string) => apiClient.acceptSessionEnding(sessionId),
    onSuccess: (_response, sessionId) => {
      // セッション情報を無効化
      queryClient.invalidateQueries({ queryKey: ['gameSession', sessionId] })
      queryClient.invalidateQueries({ queryKey: ['gameSessions'] })

      // アクティブセッションをクリア
      clearActiveSession()
    },
  })
}

// セッション終了を拒否
export const useRejectSessionEnding = () => {
  const queryClient = useQueryClient()

  return useMutation<SessionEndingRejectResponse, Error, string>({
    mutationFn: (sessionId: string) => apiClient.rejectSessionEnding(sessionId),
    onSuccess: (_response, sessionId) => {
      // 終了提案を再取得
      queryClient.invalidateQueries({
        queryKey: ['sessionEndingProposal', sessionId],
      })
    },
  })
}

// セッションリザルトを取得
export const useSessionResult = (sessionId: string | undefined) => {
  return useQuery<SessionResultResponse>({
    queryKey: ['sessionResult', sessionId],
    queryFn: () => apiClient.getSessionResult(sessionId!),
    enabled: !!sessionId,
    staleTime: Infinity, // リザルトは不変なので永久キャッシュ
  })
}

// セッション履歴を取得
export const useSessionHistory = (
  characterId: string | undefined,
  page: number = 1,
  perPage: number = 20,
  status?: 'active' | 'ending_proposed' | 'completed'
) => {
  return useQuery<any>({
    queryKey: ['sessionHistory', characterId, page, perPage, status],
    queryFn: () => apiClient.getSessionHistory(characterId!, page, perPage, status),
    enabled: !!characterId,
    staleTime: 30 * 1000, // 30秒間キャッシュ
  })
}
