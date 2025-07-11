/**
 * Socket.IOクライアント実装
 */
import { io, Socket } from 'socket.io-client'
import { apiClient } from '@/api/client'

export interface ServerToClientEvents {
  // 接続関連
  connected: (data: { message: string; sid: string; timestamp: string }) => void

  // ゲーム参加関連
  joined_game: (data: {
    message: string
    game_session_id: string
    timestamp: string
  }) => void
  left_game: (data: { message: string; timestamp: string }) => void
  player_joined: (data: { user_id: string; timestamp: string }) => void
  player_left: (data: { user_id: string; timestamp: string }) => void

  // ゲームアクション関連
  action_received: (data: {
    message: string
    action: string
    timestamp: string
  }) => void
  game_update: (data: {
    type: string
    action?: string
    result?: unknown
    timestamp: string
  }) => void

  // ゲームイベント
  game_started: (data: {
    type: string
    game_session_id: string
    initial_state: Record<string, unknown>
    timestamp: string
  }) => void

  narrative_update: (data: {
    type: string
    narrative_type: string
    narrative: string
    timestamp: string
  }) => void

  action_result: (data: {
    type: string
    user_id: string
    action: string
    result: unknown
    timestamp: string
  }) => void

  state_update: (data: {
    type: string
    update: Record<string, unknown>
    timestamp: string
  }) => void

  player_status_update: (data: {
    type: string
    user_id: string
    status: Record<string, unknown>
    timestamp: string
  }) => void

  game_ended: (data: {
    type: string
    reason: string
    final_state?: Record<string, unknown>
    timestamp: string
  }) => void

  game_error: (data: {
    type: string
    error_type: string
    message: string
    timestamp: string
  }) => void

  // チャット
  chat_message: (data: {
    user_id: string
    message: string
    timestamp: string
  }) => void

  // 通知
  notification: (data: {
    type: string
    notification_type?: string
    title?: string
    message?: string
    achievement?: {
      name: string
      description: string
    }
    from_user?: {
      name: string
    }
    timestamp: string
  }) => void

  // SP更新
  sp_update: (data: {
    type: string
    current_sp: number
    amount_changed: number
    transaction_type: string
    description: string
    balance_before: number
    balance_after: number
    metadata?: Record<string, unknown>
    timestamp: string
  }) => void

  // SP不足
  sp_insufficient: (data: {
    type: string
    required_amount: number
    current_sp: number
    action: string
    message: string
    timestamp: string
  }) => void

  // SP日次回復
  sp_daily_recovery: (data: {
    type: string
    success: boolean
    recovered_amount: number
    subscription_bonus: number
    login_bonus: number
    consecutive_days: number
    total_amount: number
    balance_after: number
    message: string
    timestamp: string
  }) => void

  // NPC遭遇
  npc_encounter: (data: {
    type: 'npc_encounter'
    encounter_type: string
    npc: {
      npc_id: string
      name: string
      title?: string | null
      npc_type: 'LOG_NPC' | 'PERMANENT_NPC' | 'TEMPORARY_NPC'
      personality_traits: string[]
      behavior_patterns: string[]
      skills: string[]
      appearance?: string | null
      backstory?: string | null
      original_player?: string | null
      log_source?: string | null
      contamination_level: number
      persistence_level: number
      current_location?: string | null
      is_active: boolean
    }
    choices?: Array<{
      id: string
      text: string
      difficulty?: 'easy' | 'medium' | 'hard' | null
      requirements?: Record<string, unknown> | null
    }>
    timestamp: string
  }) => void

  // NPCアクション結果
  npc_action_result: (data: {
    type: 'npc_action_result'
    npc_id: string
    action: string
    result: string
    state_changes?: Record<string, unknown>
    rewards?: Array<{
      type: string
      amount: number
      item?: unknown
    }>
    timestamp: string
  }) => void

  // 選択肢更新
  choices_update: (data: {
    choices: Array<{
      id: string
      text: string
      description?: string
    }>
    timestamp: string
  }) => void

  // システムメッセージ
  system_message: (data: {
    message: string
    type?: string
    timestamp: string
  }) => void

  // エラー
  error: (data: { message: string; error?: string }) => void

  // Ping/Pong
  pong: (data: { timestamp: string }) => void
}

export interface ClientToServerEvents {
  // ゲーム参加関連
  join_game: (data: { game_session_id: string; user_id: string }) => void
  leave_game: (data: { game_session_id: string; user_id: string }) => void

  // ゲームアクション
  game_action: (data: {
    game_session_id: string
    user_id: string
    action: string
  }) => void

  // チャット
  chat_message: (data: {
    game_session_id: string
    user_id: string
    message: string
  }) => void

  // NPCアクション
  npc_action: (data: {
    game_session_id: string
    user_id: string
    npc_id: string
    action: string
  }) => void

  // Ping/Pong
  ping: (data: { timestamp: string }) => void
}

class WebSocketManager {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null =
    null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectInterval = 1000 // 1秒から開始
  private listeners = new Map<string, Set<(data: unknown) => void>>()
  private joinedSessions = new Set<string>() // 参加済みセッションを追跡

  constructor() {
    // イベントリスナー管理のためのマップを初期化
    this.listeners = new Map()
  }

  /**
   * Socket.IO接続を初期化
   */
  connect(): void {
    // 既に接続中、または接続処理中の場合はスキップ
    if (this.socket) {
      if (this.socket.connected) {
        this.emit('ws:connected', { socketId: this.socket.id })
        return
      } else if (this.socket.active) {
        return
      }
    }

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
    const token = apiClient.getToken()
    const user = apiClient.getCurrentUserSync()

    this.socket = io(apiUrl, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      auth: {
        user_id: user?.id,
        token: token,
      },
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: this.reconnectInterval,
      reconnectionDelayMax: 10000,
    })

    this.setupEventHandlers()
  }

  /**
   * イベントハンドラーをセットアップ
   */
  private setupEventHandlers(): void {
    if (!this.socket) return

    // 既存のリスナーをすべて削除（重複防止）
    this.socket.removeAllListeners()

    // 接続イベント
    this.socket.on('connect', () => {
      console.log('WebSocket connected', this.socket?.id)
      this.reconnectAttempts = 0
      this.emit('ws:connected', { socketId: this.socket?.id })
    })

    // 切断イベント
    this.socket.on('disconnect', reason => {
      console.log('WebSocket disconnected', reason)
      this.emit('ws:disconnected', { reason })
    })

    // 接続エラー
    this.socket.on('connect_error', error => {
      console.error('WebSocket connection error', error)
      this.reconnectAttempts++
      this.emit('ws:error', { error: error.message })
    })

    // サーバーからのイベントをアプリケーション内部イベントに変換
    this.socket.on('connected', data => {
      this.emit('server:connected', data)
    })

    this.socket.on('joined_game', data => {
      this.emit('game:joined', data)
    })

    this.socket.on('left_game', data => {
      this.emit('game:left', data)
    })

    this.socket.on('player_joined', data => {
      this.emit('game:player_joined', data)
    })

    this.socket.on('player_left', data => {
      this.emit('game:player_left', data)
    })

    this.socket.on('game_started', data => {
      this.emit('game:started', data)
    })

    this.socket.on('narrative_update', data => {
      this.emit('game:narrative_update', data)
    })

    this.socket.on('action_result', data => {
      this.emit('game:action_result', data)
    })

    this.socket.on('state_update', data => {
      this.emit('game:state_update', data)
    })

    this.socket.on('player_status_update', data => {
      this.emit('game:player_status_update', data)
    })

    this.socket.on('game_ended', data => {
      this.emit('game:ended', data)
    })

    this.socket.on('game_error', data => {
      this.emit('game:error', data)
    })

    this.socket.on('chat_message', data => {
      this.emit('chat:message', data)
    })

    this.socket.on('notification', data => {
      this.emit('notification:received', data)
    })

    this.socket.on('sp_update', data => {
      this.emit('sp:update', data)
    })

    this.socket.on('sp_insufficient', data => {
      this.emit('sp:insufficient', data)
    })

    this.socket.on('sp_daily_recovery', data => {
      this.emit('sp:daily_recovery', data)
    })

    this.socket.on('npc_encounter', data => {
      this.emit('game:npc_encounter', data)
    })

    this.socket.on('npc_action_result', data => {
      this.emit('game:npc_action_result', data)
    })

    this.socket.on('error', data => {
      console.error('[DEBUG] Socket.IO error event:', data)
      this.emit('server:error', data)
    })

    // 選択肢更新イベント
    this.socket.on('choices_update', data => {
      this.emit('game:choices_update', data)
    })

    // システムメッセージイベント
    this.socket.on('system_message', data => {
      this.emit('game:system_message', data)
    })
    
    // メッセージ追加イベント（新規追加）
    this.socket.on('message_added', data => {
      this.emit('game:message_added', data)
    })
    
    // AI処理開始イベント（新規追加）
    this.socket.on('processing_started', data => {
      this.emit('game:processing_started', data)
    })
    
    // AI処理完了イベント（新規追加）
    this.socket.on('processing_completed', data => {
      this.emit('game:processing_completed', data)
    })
    
    // ゲーム進捗イベント（新規追加）
    this.socket.on('game_progress', data => {
      this.emit('game:progress', data)
    })
  }

  /**
   * Socket.IO接続を切断
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
      // 参加状態をクリア
      this.joinedSessions.clear()
    }
  }

  /**
   * ゲームセッションに参加
   */
  joinGame(gameSessionId: string, userId: string): void {
    console.log('[WebSocketManager.joinGame] Called', { gameSessionId, userId, connected: this.socket?.connected })
    
    if (!this.socket?.connected) {
      console.error('[WebSocketManager.joinGame] WebSocket not connected')
      return
    }

    // 既に参加済みの場合はスキップ
    const sessionKey = `${gameSessionId}-${userId}`
    if (this.joinedSessions.has(sessionKey)) {
      console.log('[WebSocketManager.joinGame] Already joined session:', sessionKey)
      return
    }

    console.log('[WebSocketManager.joinGame] Emitting join_game event', {
      game_session_id: gameSessionId,
      user_id: userId,
    })
    
    this.socket.emit('join_game', {
      game_session_id: gameSessionId,
      user_id: userId,
    })
    
    // 参加済みとして記録
    this.joinedSessions.add(sessionKey)
    console.log('[WebSocketManager.joinGame] Added to joinedSessions:', sessionKey)
  }

  /**
   * ゲームセッションから退出
   */
  leaveGame(gameSessionId: string, userId: string): void {
    if (!this.socket?.connected) {
      console.error('WebSocket not connected')
      return
    }

    const sessionKey = `${gameSessionId}-${userId}`
    
    // 参加していない場合はスキップ
    if (!this.joinedSessions.has(sessionKey)) {
      console.log('Not in session:', sessionKey)
      return
    }

    this.socket.emit('leave_game', {
      game_session_id: gameSessionId,
      user_id: userId,
    })
    
    // 参加状態を削除
    this.joinedSessions.delete(sessionKey)
  }

  /**
   * 参加済みセッションをクリア（デバッグ用）
   */
  clearJoinedSessions(): void {
    console.log('[WebSocketManager] Clearing joined sessions')
    this.joinedSessions.clear()
  }

  /**
   * ゲームアクションを送信
   */
  sendGameAction(gameSessionId: string, userId: string, action: string): void {
    if (!this.socket?.connected) {
      console.error('WebSocket not connected')
      return
    }

    const data = {
      game_session_id: gameSessionId,
      user_id: userId,
      action,
    }
    
    console.log('[DEBUG] Sending game_action event:', data)
    this.socket.emit('game_action', data)
  }

  /**
   * チャットメッセージを送信
   */
  sendChatMessage(
    gameSessionId: string,
    userId: string,
    message: string
  ): void {
    if (!this.socket?.connected) {
      console.error('WebSocket not connected')
      return
    }

    this.socket.emit('chat_message', {
      game_session_id: gameSessionId,
      user_id: userId,
      message,
    })
  }

  /**
   * Pingを送信（ハートビート）
   */
  ping(): void {
    if (!this.socket?.connected) return

    this.socket.emit('ping', { timestamp: new Date().toISOString() })
  }

  /**
   * 接続状態を取得
   */
  isConnected(): boolean {
    const connected = this.socket?.connected || false
    // デバッグログを削減（1秒ごとに呼ばれるため）
    // console.log('[WebSocketManager] isConnected() called:', {
    //   exists: !!this.socket,
    //   connected: connected,
    //   id: this.socket?.id
    // })
    return connected
  }

  /**
   * Socket IDを取得
   */
  getSocketId(): string | undefined {
    return this.socket?.id
  }

  /**
   * カスタムイベントリスナーを追加
   */
  on<T = unknown>(event: string, callback: (data: T) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)?.add(callback as (data: unknown) => void)
  }

  /**
   * カスタムイベントリスナーを削除
   */
  off<T = unknown>(event: string, callback: (data: T) => void): void {
    this.listeners.get(event)?.delete(callback as (data: unknown) => void)
  }

  /**
   * カスタムイベントを発行
   */
  private emit(event: string, data: unknown): void {
    this.listeners.get(event)?.forEach(callback => callback(data))
  }

  /**
   * NPCアクションを送信
   */
  sendNPCAction(
    gameSessionId: string,
    userId: string,
    npcId: string,
    action: string
  ): void {
    if (!this.socket?.connected) {
      console.error('WebSocket not connected')
      return
    }

    this.socket.emit('npc_action', {
      game_session_id: gameSessionId,
      user_id: userId,
      npc_id: npcId,
      action,
    })
  }
}

// シングルトンインスタンス
export const websocketManager = new WebSocketManager()
