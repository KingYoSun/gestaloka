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

const mockFragmentsList = [
  {
    id: 'fragment1',
    character_id: 'char1',
    action_description: '町の探索を行った',
    keyword: '探索',
    keywords: ['探索', '町'],
    emotional_valence: 'positive' as const,
    importance_score: 0.8,
    rarity: 'rare' as const,
    backstory: '冒険者は初めて町を探索した',
    context_data: {},
    created_at: new Date('2024-01-03T00:00:00Z'),
  },
  {
    id: 'fragment2',
    character_id: 'char1',
    action_description: '商人と交渉した',
    keyword: '交渉',
    keywords: ['交渉', '商人'],
    emotional_valence: 'neutral' as const,
    importance_score: 0.6,
    rarity: 'common' as const,
    backstory: '商人との交渉は難航した',
    context_data: {},
    created_at: new Date('2024-01-02T00:00:00Z'),
  },
]

const mockFragmentResponse = {
  fragments: mockFragmentsList,
  total: 2,
  statistics: {
    total_fragments: 2,
    by_rarity: {
      common: 1,
      uncommon: 0,
      rare: 1,
      epic: 0,
      legendary: 0,
      unique: 0,
      architect: 0,
    },
    average_importance: 0.7,
    average_contamination: 0.05,
    unique_keywords: 4,
  },
}

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
    vi.spyOn(logsApiModule.logsApiWrapper, 'getFragments').mockResolvedValue(mockFragmentResponse)

    const { result } = renderHook(() => useLogFragments('char1'), {
      wrapper: createWrapper(),
    })

    // 初期状態
    expect(result.current.isLoading).toBe(true)
    expect(result.current.data).toBeUndefined()

    // データ取得後
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
      expect(result.current.data).toEqual(mockFragmentResponse)
    })

    expect(logsApiModule.logsApiWrapper.getFragments).toHaveBeenCalledWith('char1')
  })

  it('should not fetch when characterId is empty', () => {
    vi.spyOn(logsApiModule.logsApiWrapper, 'getFragments').mockResolvedValue(mockFragmentResponse)
    
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
      character_id: 'char1',
      session_id: 'session2',
      action_description: '新しい行動',
      keywords: ['新規'],
      emotional_valence: 'positive' as const,
      importance_score: 0.7,
      rarity: 'uncommon' as const,
      contamination: 0,
      created_at: new Date('2024-01-04T00:00:00Z'),
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
      character_id: 'char1',
      session_id: 'session2',
      action_description: '新しい行動',
      keywords: ['新規'],
      emotional_valence: 'positive' as const,
      importance_score: 0.7,
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
      character_id: 'char1',
      session_id: 'session2',
      action_description: '新しい行動',
      keywords: ['新規'],
      emotional_valence: 'positive' as const,
      importance_score: 0.7,
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