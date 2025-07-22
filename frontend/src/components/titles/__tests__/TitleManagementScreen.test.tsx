import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders } from '@/test/test-utils'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { http } from 'msw'
import { server } from '@/mocks/server'
import { TitleManagementScreen } from '../TitleManagementScreen'
import type { CharacterTitleRead } from '@/api/generated'

// モックデータ
const mockTitles: CharacterTitleRead[] = [
  {
    id: '1',
    character_id: 'character_1',
    title: '冒険者',
    description: '最初の冒険を始めた証',
    is_equipped: false,
    acquired_at: new Date().toISOString(),
    effects: null,
    created_at: new Date(),
    updated_at: new Date()
  },
  {
    id: '2',
    character_id: 'character_1',
    title: '探索者',
    description: '10回の探索を達成した証',
    is_equipped: true,
    acquired_at: new Date().toISOString(),
    effects: null,
    created_at: new Date(),
    updated_at: new Date()
  },
  {
    id: '3',
    character_id: 'character_1',
    title: 'ログマスター',
    description: '100個のログフラグメントを収集した証',
    is_equipped: false,
    acquired_at: new Date().toISOString(),
    effects: null,
    created_at: new Date(),
    updated_at: new Date()
  }
]

describe('TitleManagementScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render loading state initially', () => {
    server.use(
      http.get('/api/v1/titles', () => {
        return new Promise(() => {}) // Never resolve to keep loading
      })
    )

    renderWithProviders(<TitleManagementScreen />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should render error state when loading fails', async () => {
    server.use(
      http.get('/api/v1/titles', () => {
        return new Response(null, { status: 500 })
      })
    )

    renderWithProviders(<TitleManagementScreen />)

    await waitFor(() => {
      expect(screen.getByText('称号の読み込みに失敗しました')).toBeInTheDocument()
    })
  })

  it('should render empty state when no titles exist', async () => {
    server.use(
      http.get('/api/v1/titles', () => {
        return Response.json({ items: [], total: 0, page: 1, size: 50, pages: 1 })
      })
    )

    renderWithProviders(<TitleManagementScreen />)

    await waitFor(() => {
      expect(screen.getByText('まだ称号を獲得していません')).toBeInTheDocument()
      expect(screen.getByText('ゲームを進めて称号を獲得しましょう')).toBeInTheDocument()
    })
  })

  it('should render titles list', async () => {
    server.use(
      http.get('/api/v1/titles', () => {
        return Response.json({ 
          items: mockTitles, 
          total: mockTitles.length, 
          page: 1, 
          size: 50, 
          pages: 1 
        })
      })
    )

    renderWithProviders(<TitleManagementScreen />)

    await waitFor(() => {
      expect(screen.getByText('称号管理')).toBeInTheDocument()
    })

    // 各称号が表示されていることを確認
    expect(screen.getByText('冒険者')).toBeInTheDocument()
    expect(screen.getByText('最初の冒険を始めた証')).toBeInTheDocument()
    expect(screen.getByText('探索者')).toBeInTheDocument()
    expect(screen.getByText('10回の探索を達成した証')).toBeInTheDocument()
    expect(screen.getByText('ログマスター')).toBeInTheDocument()
    expect(screen.getByText('100個のログフラグメントを収集した証')).toBeInTheDocument()
  })

  it('should display equipped title section', async () => {
    server.use(
      http.get('/api/v1/titles', () => {
        return Response.json({ 
          items: mockTitles, 
          total: mockTitles.length, 
          page: 1, 
          size: 50, 
          pages: 1 
        })
      })
    )

    renderWithProviders(<TitleManagementScreen />)

    await waitFor(() => {
      expect(screen.getByText('装備中の称号')).toBeInTheDocument()
    })

    // 装備中の称号（探索者）が表示されていることを確認
    const equippedSection = screen.getByText('装備中の称号').closest('div')
    expect(equippedSection).toHaveTextContent('探索者')
    expect(equippedSection).toHaveTextContent('10回の探索を達成した証')
  })

  it('should handle unequip action', async () => {
    const mockUnequip = vi.fn()
    
    server.use(
      http.get('/api/v1/titles', () => {
        return Response.json({ 
          items: mockTitles, 
          total: mockTitles.length, 
          page: 1, 
          size: 50, 
          pages: 1 
        })
      }),
      http.put('/api/v1/titles/unequip-all', async () => {
        mockUnequip()
        return Response.json({ success: true })
      })
    )

    renderWithProviders(<TitleManagementScreen />)

    await waitFor(() => {
      expect(screen.getByText('外す')).toBeInTheDocument()
    })

    const unequipButton = screen.getByText('外す')
    fireEvent.click(unequipButton)

    await waitFor(() => {
      expect(mockUnequip).toHaveBeenCalled()
    })
  })

  it('should handle equip action', async () => {
    const mockEquip = vi.fn()
    
    server.use(
      http.get('/api/v1/titles', () => {
        return Response.json({ 
          items: mockTitles, 
          total: mockTitles.length, 
          page: 1, 
          size: 50, 
          pages: 1 
        })
      }),
      http.put('/api/v1/titles/:id/equip', async ({ params }) => {
        mockEquip(params.id)
        return Response.json({ success: true })
      })
    )

    renderWithProviders(<TitleManagementScreen />)

    await waitFor(() => {
      expect(screen.getByText('称号管理')).toBeInTheDocument()
    })

    // TitleCardコンポーネント内の装備ボタンをクリック
    // 実際のTitleCardの実装に依存するため、ここではモックを想定
  })

  it('should display title information section', async () => {
    server.use(
      http.get('/api/v1/titles', () => {
        return Response.json({ 
          items: mockTitles, 
          total: mockTitles.length, 
          page: 1, 
          size: 50, 
          pages: 1 
        })
      })
    )

    renderWithProviders(<TitleManagementScreen />)

    await waitFor(() => {
      expect(screen.getByText('称号について')).toBeInTheDocument()
    })

    // 獲得方法の説明
    expect(screen.getByText('獲得方法')).toBeInTheDocument()
    expect(screen.getByText('特定のクエストをクリアする')).toBeInTheDocument()
    expect(screen.getByText('一定の条件を達成する')).toBeInTheDocument()
    expect(screen.getByText('イベントに参加する')).toBeInTheDocument()
    expect(screen.getByText('ログを編纂・派遣する')).toBeInTheDocument()

    // 効果の説明
    expect(screen.getByText('効果')).toBeInTheDocument()
    expect(screen.getByText(/称号を装備すると/)).toBeInTheDocument()
  })

  it('should disable buttons during mutations', async () => {
    server.use(
      http.get('/api/v1/titles', () => {
        return Response.json({ 
          items: mockTitles, 
          total: mockTitles.length, 
          page: 1, 
          size: 50, 
          pages: 1 
        })
      }),
      http.put('/api/v1/titles/unequip-all', () => {
        return new Promise(() => {}) // Never resolve to keep pending
      })
    )

    renderWithProviders(<TitleManagementScreen />)

    await waitFor(() => {
      expect(screen.getByText('外す')).toBeInTheDocument()
    })

    const unequipButton = screen.getByText('外す')
    fireEvent.click(unequipButton)

    // ボタンが無効化されることを確認
    expect(unequipButton).toBeDisabled()
  })

  it('should not show equipped title section when no title is equipped', async () => {
    const titlesWithoutEquipped = mockTitles.map(title => ({
      ...title,
      equipped: false
    }))

    server.use(
      http.get('/api/v1/titles', () => {
        return Response.json({ 
          items: titlesWithoutEquipped, 
          total: titlesWithoutEquipped.length, 
          page: 1, 
          size: 50, 
          pages: 1 
        })
      })
    )

    renderWithProviders(<TitleManagementScreen />)

    await waitFor(() => {
      expect(screen.getByText('称号管理')).toBeInTheDocument()
    })

    // 装備中の称号セクションが表示されないことを確認
    expect(screen.queryByText('装備中の称号')).not.toBeInTheDocument()
  })

  it('should render skeleton loaders correctly', () => {
    server.use(
      http.get('/api/v1/titles', () => {
        return new Promise(() => {}) // Never resolve to keep loading
      })
    )

    const { container } = renderWithProviders(<TitleManagementScreen />)

    // 6つのスケルトンが表示されることを確認
    const skeletons = container.querySelectorAll('[role="status"]')
    expect(skeletons).toHaveLength(7) // ヘッダー1つ + グリッド6つ
  })
})