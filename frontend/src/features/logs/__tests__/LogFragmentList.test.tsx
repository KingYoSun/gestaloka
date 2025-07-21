import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LogFragmentList } from '../components/LogFragmentList'
import { LogFragment } from '@/types/log'

// LogFragmentCardのモック
vi.mock('../components/LogFragmentCard', () => ({
  LogFragmentCard: ({ fragment, isSelected, onClick }: any) => (
    <div 
      data-testid={`fragment-${fragment.id}`}
      onClick={onClick}
      className={isSelected ? 'selected' : ''}
    >
      <div>{fragment.actionDescription}</div>
      <div>{fragment.emotionalValence}</div>
      <div>{fragment.rarity}</div>
      <div>{fragment.importanceScore}</div>
    </div>
  ),
}))

const mockFragments: LogFragment[] = [
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
  {
    id: 'fragment3',
    characterId: 'char1',
    sessionId: 'session2',
    actionDescription: '敵と戦闘した',
    keywords: ['戦闘', '敵'],
    emotionalValence: 'negative',
    importanceScore: 90,
    rarity: 'epic',
    contamination: 20,
    createdAt: '2024-01-01T00:00:00Z',
  },
]

describe('LogFragmentList', () => {
  it('should render fragments', () => {
    render(<LogFragmentList fragments={mockFragments} />)

    expect(screen.getByTestId('fragment-fragment1')).toBeInTheDocument()
    expect(screen.getByTestId('fragment-fragment2')).toBeInTheDocument()
    expect(screen.getByTestId('fragment-fragment3')).toBeInTheDocument()
    expect(screen.getByText('3 件のログフラグメント')).toBeInTheDocument()
  })

  it('should show loading state', () => {
    render(<LogFragmentList fragments={[]} isLoading={true} />)

    // アニメーションが付いたLoaderアイコンが表示されることを確認
    const loader = document.querySelector('.animate-spin')
    expect(loader).toBeInTheDocument()
  })

  it('should show empty state', () => {
    render(<LogFragmentList fragments={[]} />)

    expect(screen.getByText('該当するログフラグメントが見つかりません')).toBeInTheDocument()
  })

  it('should filter by search query', async () => {
    render(<LogFragmentList fragments={mockFragments} />)

    const searchInput = screen.getByPlaceholderText('行動やキーワードで検索...')
    fireEvent.change(searchInput, { target: { value: '探索' } })

    await waitFor(() => {
      expect(screen.getByTestId('fragment-fragment1')).toBeInTheDocument()
      expect(screen.queryByTestId('fragment-fragment2')).not.toBeInTheDocument()
      expect(screen.queryByTestId('fragment-fragment3')).not.toBeInTheDocument()
      expect(screen.getByText('1 件のログフラグメント')).toBeInTheDocument()
    })
  })

  it('should filter by keywords', async () => {
    render(<LogFragmentList fragments={mockFragments} />)

    const searchInput = screen.getByPlaceholderText('行動やキーワードで検索...')
    fireEvent.change(searchInput, { target: { value: '商人' } })

    await waitFor(() => {
      expect(screen.queryByTestId('fragment-fragment1')).not.toBeInTheDocument()
      expect(screen.getByTestId('fragment-fragment2')).toBeInTheDocument()
      expect(screen.queryByTestId('fragment-fragment3')).not.toBeInTheDocument()
    })
  })

  it('should filter by emotional valence', async () => {
    render(<LogFragmentList fragments={mockFragments} />)

    const selects = document.querySelectorAll('select')
    const emotionSelect = selects[0]
    fireEvent.change(emotionSelect, { target: { value: 'positive' } })

    await waitFor(() => {
      expect(screen.getByTestId('fragment-fragment1')).toBeInTheDocument()
      expect(screen.queryByTestId('fragment-fragment2')).not.toBeInTheDocument()
      expect(screen.queryByTestId('fragment-fragment3')).not.toBeInTheDocument()
      expect(screen.getByText('1 件のログフラグメント')).toBeInTheDocument()
    })
  })

  it('should filter by rarity', async () => {
    render(<LogFragmentList fragments={mockFragments} />)

    const selects = document.querySelectorAll('select')
    const raritySelect = selects[1]
    fireEvent.change(raritySelect, { target: { value: 'epic' } })

    await waitFor(() => {
      expect(screen.queryByTestId('fragment-fragment1')).not.toBeInTheDocument()
      expect(screen.queryByTestId('fragment-fragment2')).not.toBeInTheDocument()
      expect(screen.getByTestId('fragment-fragment3')).toBeInTheDocument()
      expect(screen.getByText('1 件のログフラグメント')).toBeInTheDocument()
    })
  })

  it('should sort by date', () => {
    render(<LogFragmentList fragments={mockFragments} />)

    // デフォルトは日付順（新しい順）
    const fragments = screen.getAllByTestId(/^fragment-fragment/)
    expect(fragments[0]).toHaveAttribute('data-testid', 'fragment-fragment1')
    expect(fragments[1]).toHaveAttribute('data-testid', 'fragment-fragment2')
    expect(fragments[2]).toHaveAttribute('data-testid', 'fragment-fragment3')
  })

  it('should sort by importance', async () => {
    render(<LogFragmentList fragments={mockFragments} />)

    const selects = document.querySelectorAll('select')
    const sortSelect = selects[2]
    fireEvent.change(sortSelect, { target: { value: 'importance' } })

    await waitFor(() => {
      const fragments = screen.getAllByTestId(/^fragment-fragment/)
      expect(fragments[0]).toHaveAttribute('data-testid', 'fragment-fragment3') // 90
      expect(fragments[1]).toHaveAttribute('data-testid', 'fragment-fragment1') // 80
      expect(fragments[2]).toHaveAttribute('data-testid', 'fragment-fragment2') // 60
    })
  })

  it('should sort by rarity', async () => {
    render(<LogFragmentList fragments={mockFragments} />)

    const selects = document.querySelectorAll('select')
    const sortSelect = selects[2]
    fireEvent.change(sortSelect, { target: { value: 'rarity' } })

    await waitFor(() => {
      const fragments = screen.getAllByTestId(/^fragment-fragment/)
      expect(fragments[0]).toHaveAttribute('data-testid', 'fragment-fragment3') // epic
      expect(fragments[1]).toHaveAttribute('data-testid', 'fragment-fragment1') // rare
      expect(fragments[2]).toHaveAttribute('data-testid', 'fragment-fragment2') // common
    })
  })

  it('should handle single selection mode', async () => {
    const mockOnSelect = vi.fn()
    render(
      <LogFragmentList
        fragments={mockFragments}
        selectedFragmentIds={[]}
        onFragmentSelect={mockOnSelect}
        selectionMode="single"
      />
    )

    const fragment1 = screen.getByTestId('fragment-fragment1')
    fireEvent.click(fragment1)

    expect(mockOnSelect).toHaveBeenCalledWith('fragment1')
  })

  it('should deselect in single mode when clicking selected fragment', async () => {
    const mockOnSelect = vi.fn()
    render(
      <LogFragmentList
        fragments={mockFragments}
        selectedFragmentIds={['fragment1']}
        onFragmentSelect={mockOnSelect}
        selectionMode="single"
      />
    )

    const fragment1 = screen.getByTestId('fragment-fragment1')
    fireEvent.click(fragment1)

    expect(mockOnSelect).toHaveBeenCalledWith('')
  })

  it('should handle multiple selection mode', async () => {
    const mockOnSelect = vi.fn()
    render(
      <LogFragmentList
        fragments={mockFragments}
        selectedFragmentIds={['fragment1']}
        onFragmentSelect={mockOnSelect}
        selectionMode="multiple"
      />
    )

    const fragment2 = screen.getByTestId('fragment-fragment2')
    fireEvent.click(fragment2)

    expect(mockOnSelect).toHaveBeenCalledWith('fragment2')
  })

  it('should show selection count', () => {
    render(
      <LogFragmentList
        fragments={mockFragments}
        selectedFragmentIds={['fragment1', 'fragment2']}
      />
    )

    expect(screen.getByText('3 件のログフラグメント (2 件選択中)')).toBeInTheDocument()
  })

  it('should apply multiple filters together', async () => {
    render(<LogFragmentList fragments={mockFragments} />)

    // 検索フィルターと感情価フィルターを組み合わせる
    const searchInput = screen.getByPlaceholderText('行動やキーワードで検索...')
    fireEvent.change(searchInput, { target: { value: '戦闘' } })

    const selects = document.querySelectorAll('select')
    const emotionSelect = selects[0]
    fireEvent.change(emotionSelect, { target: { value: 'negative' } })

    await waitFor(() => {
      expect(screen.queryByTestId('fragment-fragment1')).not.toBeInTheDocument()
      expect(screen.queryByTestId('fragment-fragment2')).not.toBeInTheDocument()
      expect(screen.getByTestId('fragment-fragment3')).toBeInTheDocument()
      expect(screen.getByText('1 件のログフラグメント')).toBeInTheDocument()
    })
  })

  it('should show empty state when no fragments match filters', async () => {
    render(<LogFragmentList fragments={mockFragments} />)

    const searchInput = screen.getByPlaceholderText('行動やキーワードで検索...')
    fireEvent.change(searchInput, { target: { value: '存在しないキーワード' } })

    await waitFor(() => {
      expect(screen.getByText('該当するログフラグメントが見つかりません')).toBeInTheDocument()
    })
  })
})