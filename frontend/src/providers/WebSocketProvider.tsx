/**
 * WebSocketプロバイダー
 * アプリケーション全体でWebSocket接続を管理
 */
import { useEffect, ReactNode } from 'react'
import { useWebSocket, useNotificationWebSocket } from '@/hooks/useWebSocket'
import { WebSocketContext } from './webSocketContext'
import { useAuth } from '@/features/auth/useAuth'

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const websocket = useWebSocket()
  const { isAuthenticated } = useAuth()

  // 通知WebSocketを有効化
  useNotificationWebSocket()

  // 認証済みの場合のみ自動接続
  useEffect(() => {
    if (isAuthenticated && !websocket.isConnected) {
      websocket.connect()
    } else if (!isAuthenticated && websocket.isConnected) {
      websocket.disconnect()
    }
  }, [
    isAuthenticated,
    websocket.isConnected,
    websocket.connect,
    websocket.disconnect,
  ])

  return (
    <WebSocketContext.Provider value={websocket}>
      {children}
    </WebSocketContext.Provider>
  )
}

// useWebSocketContext hook is exported from ./useWebSocketContext.ts to avoid fast refresh issues
