import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useConsumeSP, useSPBalance, useSPBalanceSummary, useDailyRecovery } from '../useSP'
import { spApi } from '@/lib/api'
import { SPConsumeRequest, PlayerSPRead, PlayerSPSummary } from '@/api/generated/models'

// APIモック
vi.mock('@/lib/api', () => ({
  spApi: {
    consumeSpApiV1SpConsumePost: vi.fn(),
    getSpBalanceApiV1SpBalanceGet: vi.fn(),
    getSpBalanceSummaryApiV1SpBalanceSummaryGet: vi.fn(),
    processDailyRecoveryApiV1SpDailyRecoveryPost: vi.fn(),
    getTransactionHistoryApiV1SpTransactionsGet: vi.fn(),
    getTransactionDetailApiV1SpTransactionsTransactionIdGet: vi.fn(),
  },
}))

// useToastモック
const mockToast = vi.fn()
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}))

// ValidationRulesContextのモック
vi.mock('@/contexts/ValidationRulesContext', () => ({
  ValidationRulesProvider: ({ children }: any) => children,
  useValidationRulesContext: () => ({
    user: {
      username: { min_length: 3, max_length: 50 },
      password: { min_length: 8, max_length: 100 },
    },
    character: {
      name: { min_length: 1, max_length: 50 },
    },
  }),
}))

// AuthProviderのモック
vi.mock('@/features/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: any) => children,
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}))

// react-routerのモック
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useSP hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('useSPBalance', () => {
    it('should fetch SP balance successfully', async () => {
      const mockBalance: PlayerSPRead = {
        playerId: 'player-1',
        currentSp: 1500,
        activeSubscription: null,
        subscriptionExpiresAt: null,
        lastDailyRecoveryAt: '2025-07-20T00:00:00Z',
        createdAt: '2025-07-01T00:00:00Z',
        updatedAt: '2025-07-20T00:00:00Z',
      }

      vi.mocked(spApi.getSpBalanceApiV1SpBalanceGet).mockResolvedValue({
        data: mockBalance,
        status: 200,
        headers: {},
        statusText: 'OK',
        config: {} as any,
      })

      const { result } = renderHook(() => useSPBalance(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(result.current.data).toEqual(mockBalance)
    })
  })

  describe('useSPBalanceSummary', () => {
    it('should fetch SP balance summary successfully', async () => {
      const mockSummary: PlayerSPSummary = {
        currentSp: 1500,
        activeSubscription: 'premium',
        subscriptionExpiresAt: '2025-08-20T00:00:00Z',
      }

      vi.mocked(spApi.getSpBalanceSummaryApiV1SpBalanceSummaryGet).mockResolvedValue({
        data: mockSummary,
        status: 200,
        headers: {},
        statusText: 'OK',
        config: {} as any,
      })

      const { result } = renderHook(() => useSPBalanceSummary(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(result.current.data).toEqual(mockSummary)
    })
  })

  describe('useConsumeSP', () => {
    it('should consume SP successfully', async () => {
      const request: SPConsumeRequest = {
        amount: 100,
        reason: 'test_action',
        relatedEntityType: 'game_session',
        relatedEntityId: 'session-1',
      }

      vi.mocked(spApi.consumeSpApiV1SpConsumePost).mockResolvedValue({
        data: {
          message: '100 SPを消費しました',
          remainingSp: 1400,
          transactionId: 'trans-1',
        },
        status: 200,
        headers: {},
        statusText: 'OK',
        config: {} as any,
      })

      const { result } = renderHook(() => useConsumeSP(), {
        wrapper: createWrapper(),
      })

      await result.current.mutateAsync(request)

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'SP消費完了',
          description: '100 SPを消費しました',
          variant: 'success',
        })
      })
    })

    it('should handle insufficient SP error', async () => {
      const request: SPConsumeRequest = {
        amount: 2000,
        reason: 'test_action',
        relatedEntityType: 'game_session',
        relatedEntityId: 'session-1',
      }

      vi.mocked(spApi.consumeSpApiV1SpConsumePost).mockRejectedValue({
        response: {
          status: 400,
          data: {
            detail: 'SP不足: 現在のSP(1500)が必要SP(2000)より少ないです',
          },
        },
      })

      const { result } = renderHook(() => useConsumeSP(), {
        wrapper: createWrapper(),
      })

      await result.current.mutateAsync(request).catch(() => {})

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'SP不足',
          description: expect.stringContaining('SP不足'),
          variant: 'destructive',
        })
      })
    })

    it('should handle general error', async () => {
      const request: SPConsumeRequest = {
        amount: 100,
        reason: 'test_action',
        relatedEntityType: 'game_session', 
        relatedEntityId: 'session-1',
      }

      vi.mocked(spApi.consumeSpApiV1SpConsumePost).mockRejectedValue({
        response: {
          status: 500,
          data: {
            detail: 'サーバーエラーが発生しました',
          },
        },
      })

      const { result } = renderHook(() => useConsumeSP(), {
        wrapper: createWrapper(),
      })

      await result.current.mutateAsync(request).catch(() => {})

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'SP消費エラー',
          description: 'サーバーエラーが発生しました',
          variant: 'destructive',
        })
      })
    })
  })

  describe('useDailyRecovery', () => {
    it('should process daily recovery successfully', async () => {
      vi.mocked(spApi.processDailyRecoveryApiV1SpDailyRecoveryPost).mockResolvedValue({
        data: {
          message: '日次回復が完了しました。+100 SP',
          recoveredAmount: 100,
          currentSp: 1600,
        },
        status: 200,
        headers: {},
        statusText: 'OK',
        config: {} as any,
      })

      const { result } = renderHook(() => useDailyRecovery(), {
        wrapper: createWrapper(),
      })

      await result.current.mutateAsync()

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: '日次回復完了',
          description: '日次回復が完了しました。+100 SP',
          variant: 'success',
        })
      })
    })

    it('should handle already recovered error', async () => {
      vi.mocked(spApi.processDailyRecoveryApiV1SpDailyRecoveryPost).mockRejectedValue({
        response: {
          status: 400,
          data: {
            detail: '本日の日次回復は既に完了しています',
          },
        },
      })

      const { result } = renderHook(() => useDailyRecovery(), {
        wrapper: createWrapper(),
      })

      await result.current.mutateAsync().catch(() => {})

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: '日次回復済み',
          description: '本日の日次回復は既に完了しています',
        })
      })
    })
  })
})