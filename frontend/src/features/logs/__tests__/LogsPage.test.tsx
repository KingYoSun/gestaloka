import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { LogsPage } from '../LogsPage'
import { renderWithProviders as render } from '@/test/test-utils'
import * as useCharactersModule from '@/hooks/useCharacters'
import * as useLogFragmentsModule from '../hooks/useLogFragments'
import * as useCompletedLogsModule from '../hooks/useCompletedLogs'
import * as useToastModule from '@/hooks/useToast'

// タブコンポーネントのモック
vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children, defaultValue }: any) => <div data-testid="tabs" data-value={defaultValue}>{children}</div>,
  TabsList: ({ children }: any) => <div data-testid="tabs-list">{children}</div>,
  TabsTrigger: ({ children, value, onClick }: any) => (
    <button data-testid={`tab-${value}`} onClick={onClick}>
      {children}
    </button>
  ),
  TabsContent: ({ children, value }: any) => (
    <div data-testid={`tab-content-${value}`} style={{ display: 'block' }}>
      {children}
    </div>
  ),
}))

// コンポーネントのモック
vi.mock('../components/LogFragmentList', () => ({
  LogFragmentList: ({ fragments: _fragments, isLoading, selectedFragmentIds, onFragmentSelect, selectionMode: _selectionMode }: any) => (
    <div data-testid="log-fragment-list">
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <button onClick={() => onFragmentSelect('fragment1')}>
          Fragment 1 {selectedFragmentIds?.includes('fragment1') ? '(selected)' : ''}
        </button>
      )}
    </div>
  ),
}))

vi.mock('../components/AdvancedLogCompilationEditor', () => ({
  AdvancedLogCompilationEditor: ({ onCompile, onCancel }: any) => (
    <div data-testid="compilation-editor">
      <button onClick={() => onCompile({
        coreFragmentId: 'fragment1',
        fragmentIds: ['fragment1'],
        name: 'Test Log',
        description: 'Test Description',
        isOmnibus: false,
      })}>
        Compile
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

vi.mock('../components/CompletedLogList', () => ({
  CompletedLogList: ({ completedLogs: _completedLogs, isLoading: _isLoading }: any) => <div data-testid="completed-log-list">Completed Logs</div>,
}))

vi.mock('../components/CreatePurificationItemDialog', () => ({
  CreatePurificationItemDialog: ({ onClose }: any) => (
    <div data-testid="purification-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

vi.mock('@/features/dispatch/components/DispatchList', () => ({
  DispatchList: () => <div data-testid="dispatch-list">Dispatch List</div>,
}))

vi.mock('@/components/memory/MemoryInheritanceScreen', () => ({
  MemoryInheritanceScreen: () => <div data-testid="memory-inheritance">Memory Inheritance</div>,
}))

const mockCharacters = [
  { id: 'char1', name: 'テストキャラクター1' },
  { id: 'char2', name: 'テストキャラクター2' },
]

const mockFragments = [
  {
    id: 'fragment1',
    character_id: 'char1',
    source_action: 'test-action-1',
    action_description: 'Test fragment content',
    keywords: ['test'],
    emotional_valence: 'positive',
    rarity: 'common',
    importance_score: 0.8,
    context_data: {},
    created_at: new Date().toISOString(),
  },
  {
    id: 'fragment2',
    character_id: 'char1',
    source_action: 'test-action-2',
    action_description: 'Another fragment',
    keywords: ['test'],
    emotional_valence: 'neutral',
    rarity: 'rare',
    importance_score: 0.6,
    context_data: {},
    created_at: new Date().toISOString(),
  },
]

const mockCompletedLogs = [
  {
    id: 'log1',
    name: 'Completed Log 1',
    description: 'Test completed log',
  },
]

const renderLogsPage = () => {
  return render(<LogsPage />)
}

describe('LogsPage', () => {
  const mockToast = vi.fn()
  const mockCreateCompletedLog = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    
    vi.spyOn(useCharactersModule, 'useCharacters').mockReturnValue({
      data: mockCharacters,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    vi.spyOn(useLogFragmentsModule, 'useLogFragments').mockReturnValue({
      data: { fragments: mockFragments },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    vi.spyOn(useCompletedLogsModule, 'useCompletedLogs').mockReturnValue({
      data: mockCompletedLogs,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    vi.spyOn(useCompletedLogsModule, 'useCreateCompletedLog').mockReturnValue({
      mutateAsync: mockCreateCompletedLog,
      isLoading: false,
      error: null,
    } as any)

    vi.spyOn(useToastModule, 'useToast').mockReturnValue({
      toast: mockToast,
    } as any)
  })

  it('should render initial state with tabs', async () => {
    renderLogsPage()

    // ページのロードを待つ
    expect(await screen.findByText('ログシステム')).toBeInTheDocument()
    expect(screen.getByTestId('tabs')).toBeInTheDocument()
    expect(screen.getByTestId('tab-fragments')).toBeInTheDocument()
    expect(screen.getByTestId('tab-completed')).toBeInTheDocument()
    expect(screen.getByTestId('tab-dispatches')).toBeInTheDocument()
    expect(screen.getByTestId('tab-memory')).toBeInTheDocument()
  })

  it('should display character selection in fragments tab', async () => {
    renderLogsPage()

    expect(await screen.findByText('キャラクター選択')).toBeInTheDocument()
    expect(screen.getByText('テストキャラクター1')).toBeInTheDocument()
    expect(screen.getByText('テストキャラクター2')).toBeInTheDocument()
  })

  it('should show loading state when characters are loading', async () => {
    vi.spyOn(useCharactersModule, 'useCharacters').mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as any)

    renderLogsPage()

    expect(await screen.findByText('読み込み中...')).toBeInTheDocument()
  })

  it('should show empty state when no characters exist', async () => {
    vi.spyOn(useCharactersModule, 'useCharacters').mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    renderLogsPage()

    expect(await screen.findByText('キャラクターがありません。まずキャラクターを作成してください。')).toBeInTheDocument()
  })

  it('should select character and show fragments', async () => {
    renderLogsPage()

    const charButton = await screen.findByText('テストキャラクター1')
    fireEvent.click(charButton)

    await waitFor(() => {
      expect(screen.getByText('テストキャラクター1 のログフラグメント')).toBeInTheDocument()
      expect(screen.getByTestId('log-fragment-list')).toBeInTheDocument()
    })
  })

  it('should show purification button when positive fragments exist', async () => {
    renderLogsPage()

    const charButton = await screen.findByText('テストキャラクター1')
    fireEvent.click(charButton)

    await waitFor(() => {
      expect(screen.getByText('浄化アイテム作成')).toBeInTheDocument()
    })
  })

  it('should handle fragment selection', async () => {
    renderLogsPage()

    // キャラクター選択
    const charButton = await screen.findByText('テストキャラクター1')
    fireEvent.click(charButton)

    await waitFor(() => {
      expect(screen.getByTestId('log-fragment-list')).toBeInTheDocument()
    })

    // フラグメント選択
    const fragmentButton = screen.getByText('Fragment 1')
    fireEvent.click(fragmentButton)

    await waitFor(() => {
      expect(screen.getByText('ログを編纂する (1)')).toBeInTheDocument()
    })
  })

  it('should show compilation editor when compile button is clicked', async () => {
    renderLogsPage()

    // キャラクター選択
    const charButton = await screen.findByText('テストキャラクター1')
    fireEvent.click(charButton)

    await waitFor(() => {
      expect(screen.getByTestId('log-fragment-list')).toBeInTheDocument()
    })

    // フラグメント選択
    fireEvent.click(screen.getByText('Fragment 1'))

    await waitFor(() => {
      expect(screen.getByText('ログを編纂する (1)')).toBeInTheDocument()
    })

    // 編纂ボタンクリック
    fireEvent.click(screen.getByText('ログを編纂する (1)'))

    await waitFor(() => {
      expect(screen.getByTestId('compilation-editor')).toBeInTheDocument()
      expect(screen.getByText('ログ編纂')).toBeInTheDocument()
    })
  })

  it('should handle log compilation success', async () => {
    mockCreateCompletedLog.mockResolvedValue({})
    
    renderLogsPage()

    // キャラクター選択
    const charButton = await screen.findByText('テストキャラクター1')
    fireEvent.click(charButton)
    
    // フラグメント選択
    await waitFor(() => {
      fireEvent.click(screen.getByText('Fragment 1'))
    })
    
    // 編纂ボタンクリック
    await waitFor(() => {
      fireEvent.click(screen.getByText('ログを編纂する (1)'))
    })

    // 編纂実行
    await waitFor(() => {
      fireEvent.click(screen.getByText('Compile'))
    })

    await waitFor(() => {
      expect(mockCreateCompletedLog).toHaveBeenCalledWith({
        creator_id: 'char1',
        core_fragment_id: 'fragment1',
        sub_fragment_ids: [],
        name: 'Test Log',
        title: undefined,
        description: 'Test Description',
        skills: [],
        personality_traits: [],
        behavior_patterns: {},
      })
      expect(mockToast).toHaveBeenCalledWith({
        title: 'ログ編纂完了',
        description: 'ログが正常に編纂されました。',
        variant: 'success',
      })
    })
  })

  it('should handle log compilation error', async () => {
    mockCreateCompletedLog.mockRejectedValue(new Error('Compilation failed'))
    
    renderLogsPage()

    // キャラクター選択
    const charButton = await screen.findByText('テストキャラクター1')
    fireEvent.click(charButton)
    
    // フラグメント選択
    await waitFor(() => {
      fireEvent.click(screen.getByText('Fragment 1'))
    })
    
    // 編纂ボタンクリック
    await waitFor(() => {
      fireEvent.click(screen.getByText('ログを編纂する (1)'))
    })

    // 編纂実行
    await waitFor(() => {
      fireEvent.click(screen.getByText('Compile'))
    })

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'エラー',
        description: 'ログの編纂に失敗しました。',
        variant: 'destructive',
      })
    })
  })

  it('should cancel compilation editor', async () => {
    renderLogsPage()

    // キャラクター選択
    const charButton = await screen.findByText('テストキャラクター1')
    fireEvent.click(charButton)
    
    // フラグメント選択
    await waitFor(() => {
      fireEvent.click(screen.getByText('Fragment 1'))
    })
    
    // 編纂ボタンクリック
    await waitFor(() => {
      fireEvent.click(screen.getByText('ログを編纂する (1)'))
    })

    // キャンセル
    await waitFor(() => {
      fireEvent.click(screen.getByText('Cancel'))
    })

    await waitFor(() => {
      expect(screen.queryByTestId('compilation-editor')).not.toBeInTheDocument()
      expect(screen.getByTestId('log-fragment-list')).toBeInTheDocument()
    })
  })

  it('should show purification dialog', async () => {
    renderLogsPage()

    // キャラクター選択
    const charButton = await screen.findByText('テストキャラクター1')
    fireEvent.click(charButton)

    await waitFor(() => {
      fireEvent.click(screen.getByText('浄化アイテム作成'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('purification-dialog')).toBeInTheDocument()
    })
  })

  it('should close purification dialog', async () => {
    renderLogsPage()

    // キャラクター選択
    const charButton = await screen.findByText('テストキャラクター1')
    fireEvent.click(charButton)

    await waitFor(() => {
      fireEvent.click(screen.getByText('浄化アイテム作成'))
    })

    await waitFor(() => {
      fireEvent.click(screen.getByText('Close'))
    })

    await waitFor(() => {
      expect(screen.queryByTestId('purification-dialog')).not.toBeInTheDocument()
    })
  })

  it('should show completed logs tab content', async () => {
    renderLogsPage()

    // ページのロードを待つ
    await screen.findByText('ログシステム')
    
    // タブをdata-testidで取得
    const completedTab = screen.getByTestId('tab-completed')
    fireEvent.click(completedTab)

    // キャラクター未選択時
    const noCharacterTexts = screen.getAllByText('キャラクターを選択してください')
    expect(noCharacterTexts.length).toBeGreaterThan(0)

    // キャラクター選択のためにフラグメントタブに戻る
    const fragmentsTab = screen.getByTestId('tab-fragments')
    fireEvent.click(fragmentsTab)
    
    // キャラクター選択
    const charButton = await screen.findByText('テストキャラクター1')
    fireEvent.click(charButton)
    
    // 完成ログタブに戻る
    fireEvent.click(completedTab)

    await waitFor(() => {
      expect(screen.getByTestId('completed-log-list')).toBeInTheDocument()
    })
  })

  it('should show dispatch list tab content', async () => {
    renderLogsPage()

    // ページのロードを待つ
    await screen.findByText('ログシステム')
    
    // タブをdata-testidで取得
    const dispatchTab = screen.getByTestId('tab-dispatches')
    fireEvent.click(dispatchTab)

    await waitFor(() => {
      expect(screen.getByTestId('dispatch-list')).toBeInTheDocument()
    })
  })

  it('should show memory inheritance tab content', async () => {
    renderLogsPage()

    // ページのロードを待つ
    await screen.findByText('ログシステム')
    
    // タブをdata-testidで取得
    const memoryTab = screen.getByTestId('tab-memory')
    fireEvent.click(memoryTab)

    // キャラクター未選択時
    const noCharacterTexts = screen.getAllByText('キャラクターを選択してください')
    expect(noCharacterTexts.length).toBeGreaterThan(0)

    // キャラクター選択のためにフラグメントタブに戻る
    const fragmentsTab = screen.getByTestId('tab-fragments')
    fireEvent.click(fragmentsTab)
    
    // キャラクター選択
    const charButton = await screen.findByText('テストキャラクター1')
    fireEvent.click(charButton)
    
    // メモリー継承タブに戻る
    fireEvent.click(memoryTab)

    await waitFor(() => {
      // 現在メモリー継承機能は開発中
      expect(screen.getByText('メモリー継承機能は現在開発中です')).toBeInTheDocument()
    })
  })
})