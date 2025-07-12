import { createContext, useContext } from 'react'

interface WebSocketContextType {
  isConnected: boolean
  status: {
    connected: boolean
    socketId?: string
    error?: string
  }
  connect: () => void
  disconnect: () => void
}

export const WebSocketContext = createContext<WebSocketContextType | null>(null)

export function useWebSocketContext() {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocketContext must be used within WebSocketProvider')
  }
  return context
}
