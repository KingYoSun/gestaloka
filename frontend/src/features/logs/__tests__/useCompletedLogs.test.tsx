import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCompletedLogs, useCreateCompletedLog, useUpdateCompletedLog } from '../hooks/useCompletedLogs'
import * as logsApiModule from '@/api/logs'
import * as useToastModule from '@/hooks/useToast'

// APIのモック
vi.mock('@/api/logs', () => ({
  logsApiWrapper: {
    getCompletedLogs: vi.fn(),
    createCompletedLog: vi.fn(),
    updateCompletedLog: vi.fn(),
  },
}))

const mockCompletedLogs = [
  {
    id: 'log1',
    creatorId: 'char1',
    name: '冒険の記録',
    title: '始まりの物語',
    description: '最初の冒険の記録',
    skills: ['探索', '交渉'],
    personalityTraits: ['勇敢', '好奇心旺盛'],
    behaviorPatterns: { exploration: 'active' },
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'log2',
    creatorId: 'char1',
    name: '戦闘の記録',
    title: '戦いの日々',
    description: '激しい戦闘の記録',
    skills: ['戦闘', '防御'],
    personalityTraits: ['勇敢', '戦略的'],
    behaviorPatterns: { combat: 'aggressive' },
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

describe('useCompletedLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should fetch completed logs successfully', async () => {
    vi.spyOn(logsApiModule.logsApiWrapper, 'getCompletedLogs').mockResolvedValue(mockCompletedLogs)

    const { result } = renderHook(() => useCompletedLogs('char1'), {
      wrapper: createWrapper(),
    })

    // 初期状態
    expect(result.current.isLoading).toBe(true)
    expect(result.current.data).toBeUndefined()

    // データ取得後
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
      expect(result.current.data).toEqual(mockCompletedLogs)
    })

    expect(logsApiModule.logsApiWrapper.getCompletedLogs).toHaveBeenCalledWith('char1')
  })

  it('should not fetch when characterId is empty', () => {
    vi.spyOn(logsApiModule.logsApiWrapper, 'getCompletedLogs').mockResolvedValue([])
    
    const { result } = renderHook(() => useCompletedLogs(''), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.data).toBeUndefined()
    expect(logsApiModule.logsApiWrapper.getCompletedLogs).not.toHaveBeenCalled()
  })

  it('should handle fetch error', async () => {
    const error = new Error('Fetch failed')
    vi.spyOn(logsApiModule.logsApiWrapper, 'getCompletedLogs').mockRejectedValue(error)

    const { result } = renderHook(() => useCompletedLogs('char1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
      expect(result.current.error).toEqual(error)
    })
  })
})

describe('useCreateCompletedLog', () => {
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

  it('should create completed log successfully', async () => {
    const newLog = {
      id: 'log3',
      creatorId: 'char1',
      coreFragmentId: 'fragment1',
      subFragmentIds: ['fragment2', 'fragment3'],
      name: '新しいログ',
      title: '新たな物語',
      description: '新しい冒険の記録',
      skills: ['探索'],
      personalityTraits: ['好奇心旺盛'],
      behaviorPatterns: {},
      createdAt: '2024-01-03T00:00:00Z',
    }

    vi.spyOn(logsApiModule.logsApiWrapper, 'createCompletedLog').mockResolvedValue(newLog)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(mockInvalidateQueries)

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useCreateCompletedLog(), { wrapper })

    const createData = {
      creatorId: 'char1',
      coreFragmentId: 'fragment1',
      subFragmentIds: ['fragment2', 'fragment3'],
      name: '新しいログ',
      title: '新たな物語',
      description: '新しい冒険の記録',
      skills: ['探索'],
      personalityTraits: ['好奇心旺盛'],
      behaviorPatterns: {},
    }

    await result.current.mutateAsync(createData)

    await waitFor(() => {
      expect(logsApiModule.logsApiWrapper.createCompletedLog).toHaveBeenCalledWith(createData)
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['completedLogs', 'char1'],
      })
      expect(mockToast).toHaveBeenCalledWith({
        title: 'ログを編纂しました',
        description: '「新しいログ」が完成しました',
        variant: 'success',
      })
    })
  })

  it('should handle create error', async () => {
    const error = new Error('Create failed')
    vi.spyOn(logsApiModule.logsApiWrapper, 'createCompletedLog').mockRejectedValue(error)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useCreateCompletedLog(), { wrapper })

    const createData = {
      creatorId: 'char1',
      coreFragmentId: 'fragment1',
      subFragmentIds: [],
      name: '新しいログ',
      description: '新しい冒険の記録',
      skills: [],
      personalityTraits: [],
      behaviorPatterns: {},
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
        description: 'ログの編纂に失敗しました',
        variant: 'destructive',
      })
    })
  })
})

describe('useUpdateCompletedLog', () => {
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

  it('should update completed log successfully', async () => {
    const updatedLog = {
      ...mockCompletedLogs[0],
      name: '更新されたログ',
      description: '更新された説明',
    }

    vi.spyOn(logsApiModule.logsApiWrapper, 'updateCompletedLog').mockResolvedValue(updatedLog)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(mockInvalidateQueries)

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useUpdateCompletedLog(), { wrapper })

    const updateData = {
      logId: 'log1',
      updates: {
        name: '更新されたログ',
        description: '更新された説明',
      },
    }

    await result.current.mutateAsync(updateData)

    await waitFor(() => {
      expect(logsApiModule.logsApiWrapper.updateCompletedLog).toHaveBeenCalledWith(
        'log1',
        updateData.updates
      )
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['completedLogs', 'char1'],
      })
      expect(mockToast).toHaveBeenCalledWith({
        title: 'ログを更新しました',
        variant: 'success',
      })
    })
  })

  it('should handle update error', async () => {
    const error = new Error('Update failed')
    vi.spyOn(logsApiModule.logsApiWrapper, 'updateCompletedLog').mockRejectedValue(error)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useUpdateCompletedLog(), { wrapper })

    const updateData = {
      logId: 'log1',
      updates: {
        name: '更新されたログ',
      },
    }

    try {
      await result.current.mutateAsync(updateData)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // エラーが発生することを期待
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'エラー',
        description: 'ログの更新に失敗しました',
        variant: 'destructive',
      })
    })
  })
})