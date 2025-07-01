/**
 * WebSocketManager service for test compatibility
 * This re-exports the websocketManager from lib/websocket/socket.ts with a compatible interface
 */
import { websocketManager } from '@/lib/websocket/socket'
import type { Socket } from 'socket.io-client'

export class WebSocketManager {
  private static instance: WebSocketManager

  static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager()
    }
    return WebSocketManager.instance
  }

  getSocket(): Socket | null {
    // Return the socket instance from websocketManager
    // This is a workaround to access private property for testing
    return (websocketManager as unknown as { socket: Socket | null }).socket
  }

  connect(): void {
    websocketManager.connect()
  }

  disconnect(): void {
    websocketManager.disconnect()
  }

  on<T = unknown>(event: string, callback: (data: T) => void): void {
    websocketManager.on(event, callback)
  }

  off<T = unknown>(event: string, callback: (data: T) => void): void {
    websocketManager.off(event, callback)
  }

  emit(event: string, data?: unknown): void {
    // For testing purposes, we need to emit custom events
    // Since the websocketManager doesn't expose emit directly,
    // we'll use the internal emit method
    ;(
      websocketManager as unknown as {
        emit: (event: string, data: unknown) => void
      }
    ).emit(event, data)
  }
}
