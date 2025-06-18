import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { useWebSocket } from './useWebSocket'
import { websocketManager } from '@/lib/websocket/socket'
import { toast } from 'sonner'

// websocketManagerのモック
vi.mock('@/lib/websocket/socket', () => ({
  websocketManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    isConnected: vi.fn().mockReturnValue(false),
  },
}))

// useAuthStoreのモック
vi.mock('@/store/authStore', () => ({
  useAuthStore: vi.fn(() => ({ isAuthenticated: true })),
}))

// toastのモック
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('初期状態で正しい値を返す', () => {
    const { result } = renderHook(() => useWebSocket())

    expect(result.current.isConnected).toBe(false)
    expect(result.current.socket).toBe(null) // production では null を返す
    expect(typeof result.current.connect).toBe('function')
    expect(typeof result.current.disconnect).toBe('function')
    expect(typeof result.current.emit).toBe('function')
    expect(typeof result.current.on).toBe('function')
    expect(typeof result.current.off).toBe('function')
  })

  it('認証されている場合、接続を開始する', () => {
    renderHook(() => useWebSocket())

    expect(websocketManager.connect).toHaveBeenCalledTimes(1)
  })

  it('接続状態が更新される', async () => {
    const { result } = renderHook(() => useWebSocket())

    // 接続成功のコールバックを取得して実行
    const onConnectedCall = vi
      .mocked(websocketManager.on)
      .mock.calls.find(call => call[0] === 'ws:connected')

    expect(onConnectedCall).toBeDefined()

    // 接続イベントをシミュレート
    act(() => {
      if (onConnectedCall && onConnectedCall[1]) {
        ;(onConnectedCall[1] as (data: { socketId: string }) => void)({
          socketId: 'test-socket-id',
        })
      }
    })

    expect(result.current.status.connected).toBe(true)
    expect(result.current.status.socketId).toBe('test-socket-id')
    expect(result.current.isConnected).toBe(true)
    expect(toast.success).toHaveBeenCalledWith(
      'リアルタイム接続が確立されました'
    )
  })

  it('切断状態が更新される', () => {
    const { result } = renderHook(() => useWebSocket())

    // 切断のコールバックを取得して実行
    const onDisconnectedCall = vi
      .mocked(websocketManager.on)
      .mock.calls.find(call => call[0] === 'ws:disconnected')

    act(() => {
      if (onDisconnectedCall && onDisconnectedCall[1]) {
        ;(onDisconnectedCall[1] as () => void)()
      }
    })

    expect(result.current.status.connected).toBe(false)
    expect(result.current.isConnected).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('リアルタイム接続が切断されました')
  })

  it('エラー状態が更新される', () => {
    const { result } = renderHook(() => useWebSocket())

    // エラーのコールバックを取得して実行
    const onErrorCall = vi
      .mocked(websocketManager.on)
      .mock.calls.find(call => call[0] === 'ws:error')

    act(() => {
      if (onErrorCall && onErrorCall[1]) {
        ;(onErrorCall[1] as (data: { error: string }) => void)({
          error: 'Connection failed',
        })
      }
    })

    expect(result.current.status.error).toBe('Connection failed')
    expect(toast.error).toHaveBeenCalledWith('接続エラー: Connection failed')
  })

  it('connectメソッドが正しく動作する', () => {
    const { result } = renderHook(() => useWebSocket())

    // 初回接続のモックをクリア
    vi.clearAllMocks()

    act(() => {
      result.current.connect()
    })

    expect(websocketManager.connect).toHaveBeenCalledTimes(1)
  })

  it('disconnectメソッドが正しく動作する', () => {
    const { result } = renderHook(() => useWebSocket())

    act(() => {
      result.current.disconnect()
    })

    expect(websocketManager.disconnect).toHaveBeenCalledTimes(1)
  })

  it('emitメソッドが呼ばれると警告が出力される', () => {
    const { result } = renderHook(() => useWebSocket())
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {})

    const event = 'test_event'
    const data = { message: 'test' }

    act(() => {
      result.current.emit(event, data)
    })

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'emit(test_event) called but not implemented in production'
    )

    consoleWarnSpy.mockRestore()
  })

  it('イベントリスナーが正しく登録・解除される', () => {
    const { result } = renderHook(() => useWebSocket())

    const event = 'test_event'
    const handler = vi.fn()

    // イベントリスナーを登録
    act(() => {
      result.current.on(event, handler)
    })

    expect(websocketManager.on).toHaveBeenCalledWith(event, handler)

    // イベントリスナーを解除
    act(() => {
      result.current.off(event, handler)
    })

    expect(websocketManager.off).toHaveBeenCalledWith(event, handler)
  })

  it('アンマウント時にクリーンアップされる', () => {
    const { unmount } = renderHook(() => useWebSocket())

    // コンポーネントをアンマウント
    unmount()

    // イベントリスナーが解除されることを確認
    expect(websocketManager.off).toHaveBeenCalledWith(
      'ws:connected',
      expect.any(Function)
    )
    expect(websocketManager.off).toHaveBeenCalledWith(
      'ws:disconnected',
      expect.any(Function)
    )
    expect(websocketManager.off).toHaveBeenCalledWith(
      'ws:error',
      expect.any(Function)
    )
  })

  it('認証されていない場合は接続しない', async () => {
    // 認証されていない状態をモック
    const { useAuthStore } = await import('@/store/authStore')
    vi.mocked(useAuthStore).mockReturnValue({
      isAuthenticated: false,
      user: null,
      token: null,
      login: vi.fn(),
      logout: vi.fn(),
      updateUser: vi.fn(),
    })

    vi.clearAllMocks()

    renderHook(() => useWebSocket())

    expect(websocketManager.connect).not.toHaveBeenCalled()
  })
})
