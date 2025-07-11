/**
 * ゲームセッション状態管理ストア
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { GameSession, GameMessage, ActionChoice } from '@/types'

interface GameSessionState {
  // アクティブセッション
  activeSession: GameSession | null

  // メッセージ履歴（セッションID -> メッセージ配列）
  messageHistory: Record<string, GameMessage[]>

  // 現在の選択肢
  currentChoices: ActionChoice[] | null

  // アクション実行中フラグ
  isExecutingAction: boolean

  // セッション開始中フラグ
  isStartingSession: boolean
}

interface GameSessionActions {
  // アクティブセッション管理
  setActiveSession: (session: GameSession | null) => void
  clearActiveSession: () => void

  // メッセージ管理
  addGameMessage: (message: GameMessage) => void
  clearMessageHistory: (sessionId?: string) => void
  getSessionMessages: (sessionId: string) => GameMessage[]

  // 選択肢管理
  setCurrentChoices: (choices: ActionChoice[] | null) => void

  // フラグ管理
  setExecutingAction: (isExecuting: boolean) => void
  setStartingSession: (isStarting: boolean) => void

  // セッション状態チェック
  hasActiveSession: () => boolean
  isSessionActive: (sessionId: string) => boolean
}

export const useGameSessionStore = create<
  GameSessionState & GameSessionActions
>()(
  persist(
    (set, get) => ({
      // 初期状態
      activeSession: null,
      messageHistory: {},
      currentChoices: null,
      isExecutingAction: false,
      isStartingSession: false,

      // アクティブセッション管理
      setActiveSession: session => {
        set({ activeSession: session })

        // セッションが設定された場合、そのセッションのメッセージ履歴を初期化
        if (session && !get().messageHistory[session.id]) {
          set(state => ({
            messageHistory: {
              ...state.messageHistory,
              [session.id]: [],
            },
          }))
        }
      },

      clearActiveSession: () => {
        set({
          activeSession: null,
          currentChoices: null,
          isExecutingAction: false,
        })
      },

      // メッセージ管理
      addGameMessage: message => {
        set(state => {
          const existingMessages = state.messageHistory[message.sessionId] || []
          
          // バックエンドでUUIDが生成されるため、ID重複チェックのみで十分
          const hasIdDuplicate = existingMessages.some(msg => msg.id === message.id)
          if (hasIdDuplicate) {
            console.warn('[GameSessionStore] Duplicate message ID detected:', message.id)
            return state
          }
          
          console.log('[GameSessionStore] Adding message:', {
            id: message.id,
            sessionId: message.sessionId,
            content: message.content.substring(0, 50) + '...'
          })
          
          return {
            messageHistory: {
              ...state.messageHistory,
              [message.sessionId]: [...existingMessages, message],
            },
          }
        })

        // メッセージにchoicesが含まれている場合は現在の選択肢として設定
        if (message.metadata?.choices) {
          set({ currentChoices: message.metadata.choices })
        }
      },

      clearMessageHistory: sessionId => {
        if (sessionId) {
          set(state => ({
            messageHistory: {
              ...state.messageHistory,
              [sessionId]: [],
            },
          }))
        } else {
          set({ messageHistory: {} })
        }
      },

      getSessionMessages: sessionId => {
        return get().messageHistory[sessionId] || []
      },

      // 選択肢管理
      setCurrentChoices: choices => {
        console.log('[GameSessionStore] Setting current choices:', choices)
        set({ currentChoices: choices })
      },

      // フラグ管理
      setExecutingAction: isExecuting => {
        set({ isExecutingAction: isExecuting })
      },

      setStartingSession: isStarting => {
        set({ isStartingSession: isStarting })
      },

      // セッション状態チェック
      hasActiveSession: () => {
        return get().activeSession !== null
      },

      isSessionActive: sessionId => {
        const { activeSession } = get()
        return (
          activeSession?.id === sessionId && activeSession?.isActive === true
        )
      },
    }),
    {
      name: 'game-session-store',
      partialize: state => ({
        // アクティブセッションとメッセージ履歴のみ永続化
        activeSession: state.activeSession,
        messageHistory: state.messageHistory,
      }),
    }
  )
)
