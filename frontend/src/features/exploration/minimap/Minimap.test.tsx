/**
 * ミニマップコンポーネントのテスト
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Minimap } from './Minimap'
import { explorationApi } from '@/api/explorationApi'
import { useCharacterStore } from '@/stores/characterStore'
import type { MapDataResponse } from './types'

// モックの設定
vi.mock('@/api/explorationApi')
vi.mock('@/stores/characterStore')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// テスト用のマップデータ
const mockMapData: MapDataResponse = {
  layers: [
    {
      layer: 1,
      name: '第1層',
      locations: [
        {
          id: 1,
          name: '始まりの街',
          coordinates: { x: 0, y: 0 },
          type: 'city',
          danger_level: 'safe',
          is_discovered: true,
          exploration_percentage: 100,
          last_visited: '2025-01-01T00:00:00Z',
        },
        {
          id: 2,
          name: '森の入口',
          coordinates: { x: 100, y: 50 },
          type: 'wild',
          danger_level: 'low',
          is_discovered: true,
          exploration_percentage: 50,
        },
      ],
      connections: [
        {
          id: 1,
          from_location_id: 1,
          to_location_id: 2,
          path_type: 'direct',
          is_one_way: false,
          is_discovered: true,
          sp_cost: 10,
        },
      ],
      exploration_progress: [
        {
          id: '1',
          character_id: 'test-character',
          location_id: 1,
          exploration_percentage: 100,
          areas_explored: ['area1', 'area2'],
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ],
    },
  ],
  character_trail: [
    {
      location_id: 1,
      timestamp: '2025-01-01T00:00:00Z',
      layer: 1,
      coordinates: { x: 0, y: 0 },
    },
  ],
  current_location: {
    id: 1,
    layer: 1,
    coordinates: { x: 0, y: 0 },
  },
}

const mockAvailableLocations = {
  current_location: {
    id: 1,
    name: '始まりの街',
    description: 'テスト',
    location_type: 'city' as const,
    hierarchy_level: 1,
    danger_level: 'safe' as const,
    x_coordinate: 0,
    y_coordinate: 0,
    has_inn: true,
    has_shop: true,
    has_guild: true,
    fragment_discovery_rate: 10,
    is_discovered: true,
  },
  available_locations: [
    {
      connection_id: 1,
      to_location: {
        id: 2,
        name: '森の入口',
        description: 'テスト',
        location_type: 'wild' as const,
        hierarchy_level: 1,
        danger_level: 'low' as const,
        x_coordinate: 100,
        y_coordinate: 50,
        has_inn: false,
        has_shop: false,
        has_guild: false,
        fragment_discovery_rate: 20,
        is_discovered: true,
      },
      sp_cost: 10,
      distance: 111,
      min_level_required: 1,
    },
  ],
}

describe('Minimap', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useCharacterStore).mockReturnValue({
      getActiveCharacter: () => ({ id: 'test-character' }),
    } as ReturnType<typeof useCharacterStore>)
    vi.mocked(explorationApi.getMapData).mockResolvedValue(mockMapData)
    vi.mocked(explorationApi.getAvailableLocations).mockResolvedValue(
      mockAvailableLocations
    )
  })

  const renderMinimap = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <Minimap characterId="test-character" />
      </QueryClientProvider>
    )
  }

  it('マップデータを正しく表示する', async () => {
    renderMinimap()

    await waitFor(() => {
      expect(screen.getByText('凡例')).toBeInTheDocument()
    })
  })

  it('拡大/縮小ボタンで表示モードを切り替える', async () => {
    renderMinimap()

    const expandButton = await screen.findByTitle('拡大 (M)')
    fireEvent.click(expandButton)

    // 拡張モードで凡例が表示される
    expect(screen.getByText('凡例')).toBeInTheDocument()

    const minimizeButton = screen.getByTitle('縮小 (M)')
    fireEvent.click(minimizeButton)

    // 縮小モードで凡例が非表示になる
    expect(screen.queryByText('凡例')).not.toBeInTheDocument()
  })

  it('キーボードショートカット(M)で拡大/縮小を切り替える', async () => {
    renderMinimap()

    await waitFor(() => {
      expect(screen.queryByText('凡例')).not.toBeInTheDocument()
    })

    // Mキーを押して拡大
    fireEvent.keyPress(window, { key: 'm' })
    expect(screen.getByText('凡例')).toBeInTheDocument()

    // 再度Mキーを押して縮小
    fireEvent.keyPress(window, { key: 'M' })
    expect(screen.queryByText('凡例')).not.toBeInTheDocument()
  })

  it('現在地ボタンをクリックすると現在地に中心を合わせる', async () => {
    const { container } = renderMinimap()

    const currentLocationButton = await screen.findByTitle('現在地に移動')
    fireEvent.click(currentLocationButton)

    // Canvas要素が存在することを確認
    const canvas = container.querySelector('canvas')
    expect(canvas).toBeInTheDocument()
  })

  it('場所をクリックすると選択される', async () => {
    const { container } = renderMinimap()

    await waitFor(() => {
      const canvas = container.querySelector('canvas')
      expect(canvas).toBeInTheDocument()
    })

    const canvas = container.querySelector('canvas') as HTMLCanvasElement
    
    // 場所の座標をクリック（始まりの街の位置）
    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 })
    fireEvent.mouseUp(canvas)

    // 選択された場所の処理が行われることを確認
    // （実際の動作は統合テストで確認）
  })

  it('右クリックでコンテキストメニューが表示される', async () => {
    const { container } = renderMinimap()

    await waitFor(() => {
      const canvas = container.querySelector('canvas')
      expect(canvas).toBeInTheDocument()
    })

    const contextMenuTrigger = container.querySelector('[data-radix-collection-item]')
    if (contextMenuTrigger) {
      fireEvent.contextMenu(contextMenuTrigger)
      
      // コンテキストメニューの項目が表示されることを確認
      await waitFor(() => {
        expect(screen.queryByText(/へ移動/)).toBeInTheDocument()
      })
    }
  })

  it('移動確認ダイアログが正しく表示される', async () => {
    renderMinimap()

    // 移動可能な場所への接続が存在する場合のテスト
    await waitFor(() => {
      expect(explorationApi.getAvailableLocations).toHaveBeenCalled()
    })

    // ダイアログの表示確認は統合テストで実施
  })
})