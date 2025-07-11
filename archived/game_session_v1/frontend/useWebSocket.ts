/**
 * WebSocketカスタムフック
 */
import { useEffect, useCallback, useState } from 'react'
import { websocketManager } from '@/lib/websocket/socket'
import { useAuth } from '@/features/auth/useAuth'
import { useGameSessionStore } from '@/stores/gameSessionStore'
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
  SessionEndingProposalData,
  SessionResultReadyData,
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
  const { isAuthenticated } = useAuth()

  useEffect(() => {
    if (!isAuthenticated) return

    // WebSocket接続を開始
    websocketManager.connect()

    // Socket.IOは非同期で接続されるため、少し待ってから初回チェック
    setTimeout(() => {
      const initialConnected = websocketManager.isConnected()
      if (initialConnected) {
        const socketId = websocketManager.getSocketId()
        setStatus({ connected: true, socketId })
      }
    }, 100)

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

    // 接続状態の定期的な確認
    const checkConnectionInterval = setInterval(() => {
      const isConnected = websocketManager.isConnected()
      setStatus(prev => {
        if (prev.connected !== isConnected) {
          return { ...prev, connected: isConnected }
        }
        return prev
      })
    }, 1000)

    // クリーンアップ
    return () => {
      websocketManager.off('ws:connected', handleConnected)
      websocketManager.off('ws:disconnected', handleDisconnected)
      websocketManager.off('ws:error', handleError)
      clearInterval(checkConnectionInterval)
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
  const { user } = useAuth()
  const { status: wsStatus } = useWebSocket()
  const [messages, setMessages] = useState<GameMessage[]>([])
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [currentNPCEncounters, setCurrentNPCEncounters] = useState<
    NPCEncounterData[]
  >([])

  useEffect(() => {
    if (!gameSessionId || !user?.id) return

    // StrictModeでの重複実行を防ぐためのフラグ
    let isMounted = true

    // WebSocket接続が確立されてからjoin_gameを送信
    const joinGameWhenReady = () => {
      if (isMounted && wsStatus.connected) {
        console.log('[useGameWebSocket] WebSocket connected, joining game session', { gameSessionId, userId: user.id })
        websocketManager.joinGame(gameSessionId, user.id)
      }
    }

    let checkInterval: NodeJS.Timeout | undefined

    // 既に接続済みの場合はすぐに参加
    if (wsStatus.connected) {
      joinGameWhenReady()
    } else {
      // 接続を待つ
      console.log('[useGameWebSocket] Waiting for WebSocket connection...')
      checkInterval = setInterval(() => {
        if (websocketManager.isConnected()) {
          clearInterval(checkInterval)
          joinGameWhenReady()
        }
      }, 100)
    }

    // イベントハンドラー
    const handleGameJoined = (data: GameJoinedData) => {
      console.log('Game joined:', data)
    }

    const handleGameStarted = (data: GameStartedData) => {
      setGameState(data.initial_state)
    }

    const handleNarrativeUpdate = (data: NarrativeUpdateData) => {
      // ローカルステートに追加（重複チェック付き）
      setMessages(prev => {
        // 最近のメッセージと同じ内容の場合はスキップ
        const lastMessage = prev[prev.length - 1]
        if (lastMessage && lastMessage.content === data.narrative && 
            new Date(lastMessage.timestamp).getTime() > Date.now() - 1000) {
          return prev
        }
        
        return [
          ...prev,
          {
            type: 'narrative',
            content: data.narrative,
            timestamp: data.timestamp,
          },
        ]
      })
      
      // current_sceneタイプの場合は最新状態の表示のみで、ストアへの追加はしない
      if (data.narrative_type === 'current_scene') {
        return
      }
      
      // narrative_updateではストアに追加しない
      // message_addedイベントでストアに追加されるため、ここでは何もしない
      console.log('[DEBUG] narrative_update handled (local state only, not adding to store)')
    }

    const handleActionResult = (data: ActionResultData) => {
      console.log('[DEBUG] action_result received:', data)
      
      // resultオブジェクトから物語と選択肢を抽出
      const result = data.result as any
      if (result && typeof result === 'object') {
        // 物語をゲームセッションストアに追加
        if (result.narrative && gameSessionId) {
          const gameStore = useGameSessionStore.getState()
          const existingMessages = gameStore.getSessionMessages(gameSessionId)
          
          // 重複チェック
          const isDuplicate = existingMessages.some(
            msg => msg.content === result.narrative && 
                   Math.abs(new Date(msg.timestamp).getTime() - new Date(data.timestamp).getTime()) < 1000
          )
          
          if (!isDuplicate) {
            // バックエンドからのメッセージIDを使用、なければクライアント側で生成
            const messageId = result.message_id || `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
            gameStore.addGameMessage({
              id: messageId,
              sessionId: gameSessionId,
              type: 'gm',
              content: result.narrative,
              timestamp: data.timestamp,
              metadata: { action_taken: data.action },
            })
          }
        }
        
        // 選択肢を更新
        if (result.choices && Array.isArray(result.choices)) {
          const gameStore = useGameSessionStore.getState()
          gameStore.setCurrentChoices(result.choices)
          console.log('[DEBUG] Updated choices from action_result:', result.choices)
        }
      }
      
      // ローカルステートにも追加（後方互換性のため）
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
      console.error('[DEBUG] Game error received:', data)
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
    const handleNPCEncounter = (
      data: NPCEncounterData | NPCEncounterData[]
    ) => {
      const encounters = Array.isArray(data) ? data : [data]
      setCurrentNPCEncounters(encounters)

      // メッセージログにも追加
      if (encounters.length === 1) {
        const npc = encounters[0].npc
        setMessages(prev => [
          ...prev,
          {
            type: 'system',
            content: `${npc.name}に遭遇しました！`,
            timestamp: encounters[0].timestamp,
          },
        ])
        // 通知も表示
        toast.info('NPCに遭遇しました！', {
          description: `${npc.name}${npc.title ? ` 「${npc.title}」` : ''}が現れました。`,
        })
      } else {
        // 複数NPC遭遇の場合
        const npcNames = encounters.map(e => e.npc.name).join('、')
        setMessages(prev => [
          ...prev,
          {
            type: 'system',
            content: `複数のNPCに遭遇しました！（${npcNames}）`,
            timestamp: encounters[0].timestamp,
          },
        ])
        // 通知も表示
        toast.info(`${encounters.length}体のNPCに遭遇しました！`, {
          description: npcNames,
        })
      }
    }

    const handleNPCActionResult = (data: NPCActionResultData) => {
      // 遭遇終了の処理
      if (
        data.result.includes('立ち去') ||
        data.result.includes('終了') ||
        data.result.includes('去って')
      ) {
        // 該当NPCの遭遇を削除
        setCurrentNPCEncounters(prev =>
          prev.filter(encounter => encounter.npc.npc_id !== data.npc_id)
        )
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

    // セッション終了提案イベントハンドラー
    const handleSessionEndingProposal = (data: SessionEndingProposalData) => {
      // セッション画面で処理されるため、ここでは何もしない
      console.log('Session ending proposal received:', data)
    }

    // セッションリザルト準備完了イベントハンドラー
    const handleSessionResultReady = (data: SessionResultReadyData) => {
      toast.success('リザルトの準備が完了しました！', {
        description: 'リザルト画面へ移動します...',
      })

      // リザルト画面へ遷移
      setTimeout(() => {
        window.location.href = `/game/${data.data.sessionId}/result`
      }, 1500)
    }

    // 選択肢更新イベントハンドラー
    const handleChoicesUpdate = (data: any) => {
      // ストアに選択肢を設定
      if (data.choices) {
        // useGameSessionStoreをフック外で使うためにimport
        const gameStore = useGameSessionStore.getState()
        gameStore.setCurrentChoices(data.choices)
      }
    }

    // システムメッセージイベントハンドラー
    const handleSystemMessage = (data: any) => {
      setMessages(prev => [
        ...prev,
        {
          type: 'system',
          content: data.content,
          timestamp: data.timestamp,
        },
      ])
      
      // ゲームセッションストアにも追加
      if (gameSessionId) {
        const gameStore = useGameSessionStore.getState()
        gameStore.addGameMessage({
          id: `msg-${Date.now()}`,
          sessionId: gameSessionId,
          type: 'system',
          content: data.content,
          timestamp: data.timestamp,
          metadata: data.metadata,
        })
      }
    }

    // メッセージ追加イベントハンドラー
    const handleMessageAdded = (data: any) => {
      console.log('[DEBUG] message_added received:', data)
      console.log('[DEBUG] Current gameSessionId:', gameSessionId)
      console.log('[DEBUG] Data has message:', !!data.message)
      
      // ゲームセッションストアに追加
      if (gameSessionId && data.message) {
        const gameStore = useGameSessionStore.getState()
        const newMessage = {
          id: data.message.id,
          sessionId: gameSessionId,
          type: data.message.sender_type === 'gm' ? 'gm' : 'user',
          content: data.message.content,
          timestamp: data.message.created_at,
          metadata: data.message.metadata,
        }
        console.log('[DEBUG] Adding message to store:', newMessage)
        gameStore.addGameMessage(newMessage)
        
        // 選択肢も更新
        if (data.choices) {
          console.log('[DEBUG] Updating choices:', data.choices)
          gameStore.setCurrentChoices(data.choices)
        }
      } else {
        console.warn('[DEBUG] Message not added - missing gameSessionId or data.message')
      }
    }

    // AI処理開始イベントハンドラー
    const handleProcessingStarted = (data: any) => {
      console.log('[DEBUG] processing_started received:', data)
      const gameStore = useGameSessionStore.getState()
      gameStore.setExecutingAction(true)
      
      // 処理中メッセージを表示
      if (data.status) {
        toast.loading(data.status, { id: 'ai-processing' })
      }
    }

    // AI処理完了イベントハンドラー
    const handleProcessingCompleted = () => {
      console.log('[DEBUG] processing_completed received')
      const gameStore = useGameSessionStore.getState()
      gameStore.setExecutingAction(false)
      toast.dismiss('ai-processing')
    }

    // ゲーム進捗イベントハンドラー
    const handleGameProgress = (data: any) => {
      console.log('[DEBUG] game_progress received:', data)
      // 処理中の進捗を表示
      if (data.progress_type === 'agent_processing' && data.message) {
        toast.loading(data.message, { id: 'ai-progress', duration: 3000 })
      }
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
    websocketManager.on('session:ending_proposal', handleSessionEndingProposal)
    websocketManager.on('session:result_ready', handleSessionResultReady)
    websocketManager.on('game:choices_update', handleChoicesUpdate)
    websocketManager.on('game:system_message', handleSystemMessage)
    websocketManager.on('game:message_added', handleMessageAdded)
    websocketManager.on('game:processing_started', handleProcessingStarted)
    websocketManager.on('game:processing_completed', handleProcessingCompleted)
    websocketManager.on('game:progress', handleGameProgress)

    // クリーンアップ
    return () => {
      // leave_gameは明示的な終了時のみ実行するため、ここでは呼ばない
      // これにより、ページリロードや不意の遷移でもセッションに戻れる

      // インターバルのクリア
      if (checkInterval) {
        clearInterval(checkInterval)
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
      websocketManager.off(
        'session:ending_proposal',
        handleSessionEndingProposal
      )
      websocketManager.off('session:result_ready', handleSessionResultReady)
      websocketManager.off('game:choices_update', handleChoicesUpdate)
      websocketManager.off('game:system_message', handleSystemMessage)
      websocketManager.off('game:message_added', handleMessageAdded)
      websocketManager.off('game:processing_started', handleProcessingStarted)
      websocketManager.off('game:processing_completed', handleProcessingCompleted)
      websocketManager.off('game:progress', handleGameProgress)
      
      // クリーンアップ時にフラグをfalseに
      isMounted = false
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
    currentNPCEncounters,
    sendNPCAction,
  }
}

/**
 * チャットWebSocketフック
 */
export function useChatWebSocket(gameSessionId?: string) {
  const { user } = useAuth()
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
