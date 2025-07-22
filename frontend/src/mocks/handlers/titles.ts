import { http } from 'msw'
import type { PlayerTitleRead } from '@/api/generated'

// Mock titles data
const mockTitles: PlayerTitleRead[] = [
  {
    id: '1',
    title_id: 'title_1',
    player_id: 'player_1',
    title: '冒険者',
    description: '最初の冒険を始めた証',
    equipped: false,
    obtained_at: new Date().toISOString()
  },
  {
    id: '2',
    title_id: 'title_2',
    player_id: 'player_1',
    title: '探索者',
    description: '10回の探索を達成した証',
    equipped: true,
    obtained_at: new Date().toISOString()
  },
  {
    id: '3',
    title_id: 'title_3',
    player_id: 'player_1',
    title: 'ログマスター',
    description: '100個のログフラグメントを収集した証',
    equipped: false,
    obtained_at: new Date().toISOString()
  }
]

const API_BASE_URL = 'http://localhost:8000'

export const titlesHandlers = [
  // Get player titles
  http.get(`${API_BASE_URL}/api/v1/titles`, () => {
    return Response.json({ 
      items: mockTitles, 
      total: mockTitles.length, 
      page: 1, 
      size: 50, 
      pages: 1 
    })
  }),

  // Equip title
  http.put(`${API_BASE_URL}/api/v1/titles/:id/equip`, ({ params }) => {
    const titleId = params.id as string
    
    // Update mock data
    mockTitles.forEach(title => {
      title.equipped = title.id === titleId
    })
    
    return Response.json({ success: true })
  }),

  // Unequip all titles
  http.put(`${API_BASE_URL}/api/v1/titles/unequip-all`, () => {
    // Update mock data
    mockTitles.forEach(title => {
      title.equipped = false
    })
    
    return Response.json({ success: true })
  })
]