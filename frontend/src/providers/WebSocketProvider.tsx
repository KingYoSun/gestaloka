/**
 * WebSocketプロバイダー
 * アプリケーション全体でWebSocket接続を管理
 */
import { createContext, useEffect, ReactNode } from 'react';
import { useWebSocket, useNotificationWebSocket } from '@/hooks/useWebSocket';

interface WebSocketContextType {
  isConnected: boolean;
  status: {
    connected: boolean;
    socketId?: string;
    error?: string;
  };
  connect: () => void;
  disconnect: () => void;
}

export const WebSocketContext = createContext<WebSocketContextType | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const websocket = useWebSocket();
  
  // 通知WebSocketを有効化
  useNotificationWebSocket();
  
  // アプリケーション起動時に自動接続
  useEffect(() => {
    if (!websocket.isConnected) {
      websocket.connect();
    }
  }, [websocket]);
  
  return (
    <WebSocketContext.Provider value={websocket}>
      {children}
    </WebSocketContext.Provider>
  );
}

// useWebSocketContext hook is exported from ./useWebSocketContext.ts to avoid fast refresh issues