import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useLogFragments, useCreateLogFragment } from '../hooks/useLogFragments'
import * as logsApiModule from '@/api/logs'
import * as useToastModule from '@/hooks/useToast'

// APIのモック
vi.mock('@/api/logs', () => ({
  logsApiWrapper: {
    getFragments: vi.fn(),
    createFragment: vi.fn(),
  },
}))

const mockFragments = [
  {
    id: 'fragment1',
    characterId: 'char1',
    sessionId: 'session1',
    actionDescription: '町の探索を行った',
    keywords: ['探索', '町'],
    emotionalValence: 'positive',
    importanceScore: 80,
    rarity: 'rare',
    contamination: 0,
    createdAt: '2024-01-03T00:00:00Z',
  },
  {
    id: 'fragment2',
    characterId: 'char1',
    sessionId: 'session1',
    actionDescription: '商人と交渉した',
    keywords: ['交渉', '商人'],
    emotionalValence: 'neutral',
    importanceScore: 60,
    rarity: 'common',
    contamination: 10,
    createdAt: '2024-01-02T00:00:00Z',
  },
]

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

describe('useLogFragments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should fetch log fragments successfully', async () => {
    vi.spyOn(logsApiModule.logsApiWrapper, 'getFragments').mockResolvedValue(mockFragments)

    const { result } = renderHook(() => useLogFragments('char1'), {
      wrapper: createWrapper(),
    })

    // 初期状態
    expect(result.current.isLoading).toBe(true)
    expect(result.current.data).toBeUndefined()

    // データ取得後
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
      expect(result.current.data).toEqual(mockFragments)
    })

    expect(logsApiModule.logsApiWrapper.getFragments).toHaveBeenCalledWith('char1')
  })

  it('should not fetch when characterId is empty', () => {
    vi.spyOn(logsApiModule.logsApiWrapper, 'getFragments').mockResolvedValue([])
    
    const { result } = renderHook(() => useLogFragments(''), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.data).toBeUndefined()
    expect(logsApiModule.logsApiWrapper.getFragments).not.toHaveBeenCalled()
  })

  it('should handle fetch error', async () => {
    const error = new Error('Fetch failed')
    vi.spyOn(logsApiModule.logsApiWrapper, 'getFragments').mockRejectedValue(error)

    const { result } = renderHook(() => useLogFragments('char1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
      expect(result.current.error).toEqual(error)
    })
  })
})

describe('useCreateLogFragment', () => {
  const mockToast = vi.fn()
  const mockInvalidateQueries = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(useToastModule, 'useToast').mockReturnValue({
      toast: mockToast,
    } as any)
    // エラーハンドリングのテスト時にconsole.errorが出力されるのを抑制
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should create log fragment successfully', async () => {
    const newFragment = {
      id: 'fragment3',
      characterId: 'char1',
      sessionId: 'session2',
      actionDescription: '新しい行動',
      keywords: ['新規'],
      emotionalValence: 'positive' as const,
      importanceScore: 70,
      rarity: 'uncommon' as const,
      contamination: 0,
      createdAt: '2024-01-04T00:00:00Z',
    }

    vi.spyOn(logsApiModule.logsApiWrapper, 'createFragment').mockResolvedValue(newFragment)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    // invalidateQueriesをスパイ
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(mockInvalidateQueries)

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useCreateLogFragment(), { wrapper })

    const createData = {
      characterId: 'char1',
      sessionId: 'session2',
      actionDescription: '新しい行動',
      keywords: ['新規'],
      emotionalValence: 'positive' as const,
      importanceScore: 70,
    }

    await result.current.mutateAsync(createData)

    await waitFor(() => {
      expect(logsApiModule.logsApiWrapper.createFragment).toHaveBeenCalledWith(createData)
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['logFragments', 'char1'],
      })
      expect(mockToast).toHaveBeenCalledWith({
        title: 'ログフラグメントを作成しました',
        variant: 'success',
      })
    })
  })

  it('should handle create error', async () => {
    const error = new Error('Create failed')
    vi.spyOn(logsApiModule.logsApiWrapper, 'createFragment').mockRejectedValue(error)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useCreateLogFragment(), { wrapper })

    const createData = {
      characterId: 'char1',
      sessionId: 'session2',
      actionDescription: '新しい行動',
      keywords: ['新規'],
      emotionalValence: 'positive' as const,
      importanceScore: 70,
    }

    try {
      await result.current.mutateAsync(createData)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // エラーが発生することを期待
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'エラー',
        description: 'ログフラグメントの作成に失敗しました',
        variant: 'destructive',
      })
    })
  })
})