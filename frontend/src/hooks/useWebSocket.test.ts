import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Socket } from 'socket.io-client';

import { useWebSocket } from './useWebSocket';
import { WebSocketManager } from '../services/websocket';

// WebSocketManagerのモック
vi.mock('../services/websocket', () => ({
  WebSocketManager: {
    getInstance: vi.fn(),
  },
}));

describe('useWebSocket', () => {
  let mockSocket: Partial<Socket>;
  let mockManager: Partial<WebSocketManager>;

  beforeEach(() => {
    // Socket.IOのモック
    mockSocket = {
      connected: false,
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    // WebSocketManagerのモック
    mockManager = {
      getSocket: vi.fn().mockReturnValue(mockSocket as Socket),
      connect: vi.fn(),
      disconnect: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    };

    // モックを返すように設定
    vi.mocked(WebSocketManager.getInstance).mockReturnValue(mockManager as WebSocketManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('初期状態で正しい値を返す', () => {
    const { result } = renderHook(() => useWebSocket());

    expect(result.current.isConnected).toBe(false);
    expect(result.current.socket).toBe(mockSocket);
    expect(typeof result.current.connect).toBe('function');
    expect(typeof result.current.disconnect).toBe('function');
    expect(typeof result.current.emit).toBe('function');
    expect(typeof result.current.on).toBe('function');
    expect(typeof result.current.off).toBe('function');
  });

  it('接続状態が更新される', () => {
    const { result } = renderHook(() => useWebSocket());

    // 接続イベントをシミュレート
    act(() => {
      mockSocket.connected = true;
      const onCall = vi.mocked(mockSocket.on).mock.calls.find(call => call[0] === 'connect');
      if (onCall && onCall[1]) {
        (onCall[1] as Function)();
      }
    });

    expect(result.current.isConnected).toBe(true);

    // 切断イベントをシミュレート
    act(() => {
      mockSocket.connected = false;
      const offCall = vi.mocked(mockSocket.on).mock.calls.find(call => call[0] === 'disconnect');
      if (offCall && offCall[1]) {
        (offCall[1] as Function)();
      }
    });

    expect(result.current.isConnected).toBe(false);
  });

  it('connectメソッドが正しく動作する', () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => {
      result.current.connect();
    });

    expect(mockManager.connect).toHaveBeenCalledTimes(1);
  });

  it('disconnectメソッドが正しく動作する', () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => {
      result.current.disconnect();
    });

    expect(mockManager.disconnect).toHaveBeenCalledTimes(1);
  });

  it('emitメソッドが正しく動作する', () => {
    const { result } = renderHook(() => useWebSocket());

    const event = 'test_event';
    const data = { message: 'test' };

    act(() => {
      result.current.emit(event, data);
    });

    expect(mockManager.emit).toHaveBeenCalledWith(event, data);
  });

  it('イベントリスナーが正しく登録・解除される', () => {
    const { result } = renderHook(() => useWebSocket());

    const event = 'test_event';
    const handler = vi.fn();

    // イベントリスナーを登録
    act(() => {
      result.current.on(event, handler);
    });

    expect(mockManager.on).toHaveBeenCalledWith(event, handler);

    // イベントリスナーを解除
    act(() => {
      result.current.off(event, handler);
    });

    expect(mockManager.off).toHaveBeenCalledWith(event, handler);
  });

  it('戦闘イベントが正しく処理される', () => {
    const { result } = renderHook(() => useWebSocket());

    const battleHandler = vi.fn();

    // battle_startイベントのハンドラーを登録
    act(() => {
      result.current.on('battle_start', battleHandler);
    });

    // battle_startイベントをシミュレート
    const battleData = {
      combatants: [
        { id: 'player_1', name: 'ヒーロー', hp: 100 },
        { id: 'enemy_1', name: 'ゴブリン', hp: 40 },
      ],
    };

    act(() => {
      const onCall = vi.mocked(mockManager.on).mock.calls.find(
        call => call[0] === 'battle_start'
      );
      if (onCall && onCall[1]) {
        (onCall[1] as Function)(battleData);
      }
    });

    expect(battleHandler).toHaveBeenCalledWith(battleData);
  });

  it('アンマウント時にクリーンアップされる', () => {
    const { unmount } = renderHook(() => useWebSocket());

    // コンポーネントをアンマウント
    unmount();

    // イベントリスナーが解除されることを確認
    expect(mockSocket.off).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockSocket.off).toHaveBeenCalledWith('disconnect', expect.any(Function));
  });

  it('複数のコンポーネントで同じインスタンスを共有する', () => {
    const { result: result1 } = renderHook(() => useWebSocket());
    const { result: result2 } = renderHook(() => useWebSocket());

    // 同じソケットインスタンスを共有していることを確認
    expect(result1.current.socket).toBe(result2.current.socket);

    // 一方で接続しても、両方に反映される
    act(() => {
      mockSocket.connected = true;
      const onCall = vi.mocked(mockSocket.on).mock.calls.find(call => call[0] === 'connect');
      if (onCall && onCall[1]) {
        (onCall[1] as Function)();
      }
    });

    expect(result1.current.isConnected).toBe(true);
    expect(result2.current.isConnected).toBe(true);
  });

  it('再接続時にイベントハンドラーが保持される', () => {
    const { result } = renderHook(() => useWebSocket());

    const handler = vi.fn();

    // イベントハンドラーを登録
    act(() => {
      result.current.on('test_event', handler);
    });

    // 切断
    act(() => {
      result.current.disconnect();
    });

    // 再接続
    act(() => {
      result.current.connect();
    });

    // ハンドラーが再登録されていることを確認
    expect(mockManager.on).toHaveBeenCalledWith('test_event', handler);
  });
});