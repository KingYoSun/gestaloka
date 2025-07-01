/**
 * ミニマップ視覚効果のストーリーブック
 */

import type { Meta, StoryObj } from '@storybook/react'
import { Minimap } from '../Minimap'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MinimapCanvas } from '../MinimapCanvas'
import { useState } from 'react'
import type { Viewport, LayerData } from '../types'

const queryClient = new QueryClient()

const meta: Meta<typeof Minimap> = {
  title: 'Features/Exploration/Minimap/VisualEffects',
  component: Minimap,
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <div style={{ height: '100vh', position: 'relative' }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof Minimap>

// モックデータ
const mockLayerData: LayerData = {
  layer: 1,
  name: '第一階層',
  locations: [
    {
      id: '1',
      name: '始まりの街',
      coordinates: { x: 0, y: 0 },
      type: 'city',
      danger_level: 'safe',
      is_discovered: true,
      exploration_percentage: 100,
      last_visited: new Date().toISOString(),
    },
    {
      id: '2',
      name: '古の森',
      coordinates: { x: 200, y: -100 },
      type: 'wild',
      danger_level: 'low',
      is_discovered: true,
      exploration_percentage: 75,
    },
    {
      id: '3',
      name: '忘れられた遺跡',
      coordinates: { x: -150, y: 200 },
      type: 'dungeon',
      danger_level: 'medium',
      is_discovered: true,
      exploration_percentage: 30,
    },
    {
      id: '4',
      name: '霧の湖畔',
      coordinates: { x: 300, y: 150 },
      type: 'special',
      danger_level: 'high',
      is_discovered: false,
      exploration_percentage: 0,
    },
    {
      id: '5',
      name: '交易の町',
      coordinates: { x: -200, y: -150 },
      type: 'town',
      danger_level: 'safe',
      is_discovered: true,
      exploration_percentage: 100,
      last_visited: new Date(Date.now() - 86400000).toISOString(),
    },
  ],
  connections: [
    {
      id: 1,
      from_location_id: '1',
      to_location_id: '2',
      path_type: 'direct',
      is_one_way: false,
      is_discovered: true,
      sp_cost: 5,
    },
    {
      id: 2,
      from_location_id: '1',
      to_location_id: '3',
      path_type: 'curved',
      is_one_way: false,
      is_discovered: true,
      sp_cost: 8,
    },
    {
      id: 3,
      from_location_id: '2',
      to_location_id: '4',
      path_type: 'teleport',
      is_one_way: false,
      is_discovered: false,
      sp_cost: 15,
    },
    {
      id: 4,
      from_location_id: '1',
      to_location_id: '5',
      path_type: 'stairs',
      is_one_way: false,
      is_discovered: true,
      sp_cost: 10,
    },
    {
      id: 5,
      from_location_id: '3',
      to_location_id: '4',
      path_type: 'direct',
      is_one_way: true,
      is_discovered: false,
      sp_cost: 12,
    },
  ],
  exploration_progress: [
    {
      id: '1',
      character_id: 'test',
      location_id: '1',
      exploration_percentage: 100,
      areas_explored: ['market', 'inn', 'guild'],
      fully_explored_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: '2',
      character_id: 'test',
      location_id: '2',
      exploration_percentage: 75,
      areas_explored: ['entrance', 'clearing'],
      fog_revealed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: '3',
      character_id: 'test',
      location_id: '3',
      exploration_percentage: 30,
      areas_explored: ['entrance'],
      fog_revealed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: '5',
      character_id: 'test',
      location_id: '5',
      exploration_percentage: 100,
      areas_explored: ['market', 'residential'],
      fully_explored_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
}

// Canvas視覚効果デモコンポーネント
export const VisualEffectsDemo = () => {
  const [viewport, setViewport] = useState<Viewport>({
    x: 0,
    y: 0,
    zoom: 1,
    width: 800,
    height: 600,
  })

  const characterTrail = [
    {
      location_id: '1',
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      layer: 1,
      coordinates: { x: 0, y: 0 },
    },
    {
      location_id: '2',
      timestamp: new Date(Date.now() - 1800000).toISOString(),
      layer: 1,
      coordinates: { x: 200, y: -100 },
    },
    {
      location_id: '3',
      timestamp: new Date().toISOString(),
      layer: 1,
      coordinates: { x: -150, y: 200 },
    },
  ]

  return (
    <div className="w-full h-full bg-gray-900 p-8">
      <div className="bg-black rounded-lg overflow-hidden" style={{ width: 800, height: 600 }}>
        <MinimapCanvas
          layerData={mockLayerData}
          currentLocation={{ id: '3', layer: 1, coordinates: { x: -150, y: 200 } }}
          characterTrail={characterTrail}
          viewport={viewport}
          onViewportChange={setViewport}
          showLabels={true}
          showGrid={true}
        />
      </div>
      <div className="mt-4 text-white space-y-2">
        <h3 className="text-lg font-semibold">視覚効果デモ</h3>
        <ul className="text-sm space-y-1">
          <li>✨ 改善された霧効果（多層グラデーション）</li>
          <li>🎯 場所タイプ別のアイコン表示</li>
          <li>💫 発見アニメーション（新規場所）</li>
          <li>🌟 完全探索済み場所のパルス効果</li>
          <li>🔗 現在地に接続された経路のハイライト</li>
          <li>📍 移動履歴のアニメーション表示</li>
        </ul>
      </div>
    </div>
  )
}

// 各視覚効果のストーリー
export const FogOfWarEffect: Story = {
  render: () => <VisualEffectsDemo />,
}

export const DiscoveryAnimation: Story = {
  render: () => {
    const [discovered, setDiscovered] = useState(false)
    const layerData = {
      ...mockLayerData,
      locations: mockLayerData.locations.map(loc => ({
        ...loc,
        is_discovered: loc.id === '4' ? discovered : loc.is_discovered,
      })),
    }

    return (
      <div className="p-8">
        <button
          onClick={() => setDiscovered(!discovered)}
          className="mb-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          {discovered ? '場所を隠す' : '新しい場所を発見'}
        </button>
        <div className="bg-black rounded-lg overflow-hidden" style={{ width: 600, height: 400 }}>
          <MinimapCanvas
            layerData={layerData}
            viewport={{ x: 150, y: 75, zoom: 1, width: 600, height: 400 }}
            onViewportChange={() => {}}
            characterTrail={[]}
            showLabels={true}
          />
        </div>
      </div>
    )
  },
}

export const HoverEffects: Story = {
  render: () => (
    <div className="p-8">
      <p className="text-white mb-4">マップ上の場所にホバーしてツールチップを表示</p>
      <Minimap characterId="demo" />
    </div>
  ),
}