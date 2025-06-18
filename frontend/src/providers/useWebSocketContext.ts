import { useContext } from 'react'
import { WebSocketContext } from './WebSocketProvider'

export function useWebSocketContext() {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocketContext must be used within WebSocketProvider')
  }
  return context
}
