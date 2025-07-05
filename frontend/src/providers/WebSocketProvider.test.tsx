import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, screen } from '@testing-library/react'
import { act } from 'react'

import { WebSocketProvider } from './WebSocketProvider'
import { useWebSocketContext } from './useWebSocketContext'
import { useWebSocket, useNotificationWebSocket } from '@/hooks/useWebSocket'
import { useAuth } from '@/features/auth/useAuth'

// useAuthのモック
vi.mock('@/features/auth/useAuth', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true })),
}))

// useWebSocketのモック
const mockWebSocket = {
  isConnected: false,
  status: { connected: false, socketId: null, error: null },
  connect: vi.fn(),
  disconnect: vi.fn(),
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  socket: null,
}

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(() => mockWebSocket),
  useNotificationWebSocket: vi.fn(),
}))

describe('WebSocketProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // モックの初期状態をリセット
    mockWebSocket.isConnected = false
    mockWebSocket.status = { connected: false, socketId: null, error: null }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('コンテキストを提供する', () => {
    const TestComponent = () => {
      const context = useWebSocketContext()
      return (
        <div>
          <span data-testid="connected">
            {context.isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      )
    }

    render(
      <WebSocketProvider>
        <TestComponent />
      </WebSocketProvider>
    )

    expect(screen.getByTestId('connected')).toHaveTextContent('Disconnected')
  })

  it('認証済みの場合、自動的に接続を開始する', async () => {
    render(
      <WebSocketProvider>
        <div>Test</div>
      </WebSocketProvider>
    )

    await waitFor(() => {
      expect(mockWebSocket.connect).toHaveBeenCalledTimes(1)
    })
  })

  it('認証されていない場合は接続しない', async () => {
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: false,
      user: null,
      isLoading: false,
      refreshAuth: vi.fn(),
    })

    vi.clearAllMocks()

    render(
      <WebSocketProvider>
        <div>Test</div>
      </WebSocketProvider>
    )

    await waitFor(() => {
      expect(mockWebSocket.connect).not.toHaveBeenCalled()
    })
  })

  it('接続状態を正しく提供する', async () => {
    const TestComponent = () => {
      const context = useWebSocketContext()
      return (
        <div>
          <span data-testid="connected">
            {context.isConnected ? 'Connected' : 'Disconnected'}
          </span>
          <span data-testid="socketId">{context.status.socketId || 'No ID'}</span>
        </div>
      )
    }

    // 接続状態をシミュレート
    mockWebSocket.isConnected = true
    mockWebSocket.status = { connected: true, socketId: 'test-socket-id', error: null }

    render(
      <WebSocketProvider>
        <TestComponent />
      </WebSocketProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('connected')).toHaveTextContent('Connected')
      expect(screen.getByTestId('socketId')).toHaveTextContent('test-socket-id')
    })
  })

  it('認証状態が変更されると接続/切断する', async () => {
    // 最初は未認証状態
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: false,
      user: null,
      isLoading: false,
      refreshAuth: vi.fn(),
    })

    const { rerender } = render(
      <WebSocketProvider>
        <div>Test</div>
      </WebSocketProvider>
    )

    // 接続されていないことを確認
    expect(mockWebSocket.connect).not.toHaveBeenCalled()

    // 認証状態を認証済みに変更
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      user: null,
      isLoading: false,
      refreshAuth: vi.fn(),
    })

    rerender(
      <WebSocketProvider>
        <div>Test</div>
      </WebSocketProvider>
    )

    await waitFor(() => {
      expect(mockWebSocket.connect).toHaveBeenCalledTimes(1)
    })

    // 再度未認証に変更して切断を確認
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: false,
      user: null,
      isLoading: false,
      refreshAuth: vi.fn(),
    })
    mockWebSocket.isConnected = true // 接続中と仮定

    rerender(
      <WebSocketProvider>
        <div>Test</div>
      </WebSocketProvider>
    )

    await waitFor(() => {
      expect(mockWebSocket.disconnect).toHaveBeenCalledTimes(1)
    })
  })

  it('エラー状態を正しく提供する', async () => {
    const TestComponent = () => {
      const context = useWebSocketContext()
      return (
        <div>
          <span data-testid="error">{context.status.error || 'No Error'}</span>
        </div>
      )
    }

    // エラー状態をシミュレート
    mockWebSocket.status = { connected: false, socketId: null, error: 'Connection failed' }

    render(
      <WebSocketProvider>
        <TestComponent />
      </WebSocketProvider>
    )

    expect(screen.getByTestId('error')).toHaveTextContent('Connection failed')
  })

  it('useNotificationWebSocketフックが呼ばれる', () => {
    render(
      <WebSocketProvider>
        <div>Test</div>
      </WebSocketProvider>
    )

    expect(useNotificationWebSocket).toHaveBeenCalledTimes(1)
  })
})