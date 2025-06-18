/**
 * WebSocketプロバイダー
 * アプリケーション全体でWebSocket接続を管理
 */
import { useEffect, ReactNode } from 'react'
import { useWebSocket, useNotificationWebSocket } from '@/hooks/useWebSocket'
import { WebSocketContext } from './webSocketContext'

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const websocket = useWebSocket()

  // 通知WebSocketを有効化
  useNotificationWebSocket()

  // アプリケーション起動時に自動接続
  useEffect(() => {
    if (!websocket.isConnected) {
      websocket.connect()
    }
  }, [websocket])

  return (
    <WebSocketContext.Provider value={websocket}>
      {children}
    </WebSocketContext.Provider>
  )
}

// useWebSocketContext hook is exported from ./useWebSocketContext.ts to avoid fast refresh issues
