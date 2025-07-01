/**
 * WebSocketカスタムフック
 */
import { useEffect, useCallback, useState } from 'react'
import { websocketManager } from '@/lib/websocket/socket'
import { useAuthStore } from '@/store/authStore'
import { toast } from 'sonner'
import type {
  GameMessage,
  GameState,
  GameJoinedData,
  GameStartedData,
  NarrativeUpdateData,
  ActionResultData,
  StateUpdateData,
  GameErrorData,
  ChatMessage,
  NotificationData,
  NPCEncounterData,
  NPCActionResultData,
} from '@/types/websocket'

export interface WebSocketStatus {
  connected: boolean
  socketId?: string
  error?: string
}

export function useWebSocket() {
  const [status, setStatus] = useState<WebSocketStatus>({
    connected: false,
  })
  const { isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated) return

    // WebSocket接続を開始
    websocketManager.connect()

    // 接続状態の監視
    const handleConnected = (data: { socketId: string }) => {
      setStatus({ connected: true, socketId: data.socketId })
      toast.success('リアルタイム接続が確立されました')
    }

    const handleDisconnected = () => {
      setStatus({ connected: false })
      toast.error('リアルタイム接続が切断されました')
    }

    const handleError = (data: { error: string }) => {
      setStatus(prev => ({ ...prev, error: data.error }))
      toast.error(`接続エラー: ${data.error}`)
    }

    websocketManager.on('ws:connected', handleConnected)
    websocketManager.on('ws:disconnected', handleDisconnected)
    websocketManager.on('ws:error', handleError)

    // クリーンアップ
    return () => {
      websocketManager.off('ws:connected', handleConnected)
      websocketManager.off('ws:disconnected', handleDisconnected)
      websocketManager.off('ws:error', handleError)
    }
  }, [isAuthenticated])

  // 手動での接続/切断
  const connect = useCallback(() => {
    websocketManager.connect()
  }, [])

  const disconnect = useCallback(() => {
    websocketManager.disconnect()
  }, [])

  // emit method for test compatibility
  const emit = useCallback((event: string, _data?: unknown) => {
    // For now, this is a no-op as websocketManager doesn't expose emit directly
    // This is mainly for test compatibility
    console.warn(`emit(${event}) called but not implemented in production`)
  }, [])

  // on/off methods for test compatibility
  const on = useCallback(
    <T = unknown>(event: string, handler: (data: T) => void) => {
      websocketManager.on(event, handler)
    },
    []
  )

  const off = useCallback(
    <T = unknown>(event: string, handler: (data: T) => void) => {
      websocketManager.off(event, handler)
    },
    []
  )

  // イベント購読用のヘルパー関数
  const subscribe = useCallback(
    <T = unknown>(event: string, handler: (data: T) => void) => {
      websocketManager.on(event, handler)
      // クリーンアップ関数を返す
      return () => websocketManager.off(event, handler)
    },
    []
  )

  return {
    status,
    connect,
    disconnect,
    isConnected: status.connected,
    // For test compatibility - return socket as null in production
    socket: null,
    emit,
    on,
    off,
    subscribe,
  }
}

/**
 * ゲームWebSocketフック
 */
export function useGameWebSocket(gameSessionId?: string) {
  const { user } = useAuthStore()
  const [messages, setMessages] = useState<GameMessage[]>([])
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [currentNPCEncounter, setCurrentNPCEncounter] =
    useState<NPCEncounterData | null>(null)

  useEffect(() => {
    if (!gameSessionId || !user?.id) return

    // ゲームセッションに参加
    websocketManager.joinGame(gameSessionId, user.id)

    // イベントハンドラー
    const handleGameJoined = (data: GameJoinedData) => {
      console.log('Game joined:', data)
    }

    const handleGameStarted = (data: GameStartedData) => {
      setGameState(data.initial_state)
    }

    const handleNarrativeUpdate = (data: NarrativeUpdateData) => {
      setMessages(prev => [
        ...prev,
        {
          type: 'narrative',
          content: data.narrative,
          timestamp: data.timestamp,
        },
      ])
    }

    const handleActionResult = (data: ActionResultData) => {
      setMessages(prev => [
        ...prev,
        {
          type: 'action_result',
          action: data.action,
          result: data.result,
          timestamp: data.timestamp,
        },
      ])
    }

    const handleStateUpdate = (data: StateUpdateData) => {
      setGameState(prev =>
        prev ? { ...prev, ...data.update } : (data.update as GameState)
      )
    }

    const handleGameError = (data: GameErrorData) => {
      toast.error(data.message)
    }

    // 戦闘イベントハンドラー
    const handleBattleStart = (data: unknown) => {
      console.log('Battle started:', data)
      // 戦闘開始の通知
      toast.info('戦闘開始！', {
        description: '敵が現れた！',
      })
    }

    const handleBattleUpdate = (data: unknown) => {
      console.log('Battle update:', data)
      // 戦闘状態の更新はaction_resultで処理される
    }

    // NPC遭遇イベントハンドラー
    const handleNPCEncounter = (data: NPCEncounterData) => {
      setCurrentNPCEncounter(data)
      // メッセージログにも追加
      setMessages(prev => [
        ...prev,
        {
          type: 'system',
          content: `${data.npc.name}に遭遇しました！`,
          timestamp: data.timestamp,
        },
      ])
      // 通知も表示
      toast.info('NPCに遭遇しました！', {
        description: `${data.npc.name}${data.npc.title ? ` 「${data.npc.title}」` : ''}が現れました。`,
      })
    }

    const handleNPCActionResult = (data: NPCActionResultData) => {
      // 遭遇終了の処理
      if (
        data.result.includes('立ち去') ||
        data.result.includes('終了') ||
        data.result.includes('去って')
      ) {
        setCurrentNPCEncounter(null)
      }
      // 結果をメッセージログに追加
      setMessages(prev => [
        ...prev,
        {
          type: 'action_result',
          action: data.action,
          result: data.result,
          timestamp: data.timestamp,
        },
      ])
    }

    // イベントリスナー登録
    websocketManager.on('game:joined', handleGameJoined)
    websocketManager.on('game:started', handleGameStarted)
    websocketManager.on('game:narrative_update', handleNarrativeUpdate)
    websocketManager.on('game:action_result', handleActionResult)
    websocketManager.on('game:state_update', handleStateUpdate)
    websocketManager.on('game:error', handleGameError)
    websocketManager.on('game:battle_start', handleBattleStart)
    websocketManager.on('game:battle_update', handleBattleUpdate)
    websocketManager.on('game:npc_encounter', handleNPCEncounter)
    websocketManager.on('game:npc_action_result', handleNPCActionResult)

    // クリーンアップ
    return () => {
      if (gameSessionId && user?.id) {
        websocketManager.leaveGame(gameSessionId, user.id)
      }

      websocketManager.off('game:joined', handleGameJoined)
      websocketManager.off('game:started', handleGameStarted)
      websocketManager.off('game:narrative_update', handleNarrativeUpdate)
      websocketManager.off('game:action_result', handleActionResult)
      websocketManager.off('game:state_update', handleStateUpdate)
      websocketManager.off('game:error', handleGameError)
      websocketManager.off('game:battle_start', handleBattleStart)
      websocketManager.off('game:battle_update', handleBattleUpdate)
      websocketManager.off('game:npc_encounter', handleNPCEncounter)
      websocketManager.off('game:npc_action_result', handleNPCActionResult)
    }
  }, [gameSessionId, user?.id])

  // アクション送信
  const sendAction = useCallback(
    (action: string) => {
      if (!gameSessionId || !user?.id) return

      websocketManager.sendGameAction(gameSessionId, user.id, action)
    },
    [gameSessionId, user?.id]
  )

  // NPCアクション送信
  const sendNPCAction = useCallback(
    (npcId: string, action: string) => {
      if (!gameSessionId || !user?.id) return

      websocketManager.sendNPCAction(gameSessionId, user.id, npcId, action)
    },
    [gameSessionId, user?.id]
  )

  return {
    messages,
    gameState,
    sendAction,
    currentNPCEncounter,
    sendNPCAction,
  }
}

/**
 * チャットWebSocketフック
 */
export function useChatWebSocket(gameSessionId?: string) {
  const { user } = useAuthStore()
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])

  useEffect(() => {
    if (!gameSessionId) return

    const handleChatMessage = (data: ChatMessage) => {
      setChatMessages(prev => [...prev, data])
    }

    websocketManager.on('chat:message', handleChatMessage)

    return () => {
      websocketManager.off('chat:message', handleChatMessage)
    }
  }, [gameSessionId])

  // チャットメッセージ送信
  const sendChatMessage = useCallback(
    (message: string) => {
      if (!gameSessionId || !user?.id) return

      websocketManager.sendChatMessage(gameSessionId, user.id, message)
    },
    [gameSessionId, user?.id]
  )

  return {
    chatMessages,
    sendChatMessage,
  }
}

/**
 * 通知WebSocketフック
 */
export function useNotificationWebSocket() {
  useEffect(() => {
    const handleNotification = (data: NotificationData) => {
      // 通知タイプに応じて処理
      switch (data.type) {
        case 'system_notification':
          toast[data.notification_type || 'info'](data.message, {
            description: data.title,
          })
          break

        case 'achievement':
          if (data.achievement) {
            toast.success(`実績「${data.achievement.name}」を獲得しました！`, {
              description: data.achievement.description,
            })
          }
          break

        case 'friend_request':
          if (data.from_user) {
            toast.info(
              `${data.from_user.name}さんからフレンドリクエストが届きました`
            )
          }
          break

        default:
          console.log('Unknown notification type:', data)
      }
    }

    websocketManager.on('notification:received', handleNotification)

    return () => {
      websocketManager.off('notification:received', handleNotification)
    }
  }, [])
}
