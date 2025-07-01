import { createContext } from 'react'

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
