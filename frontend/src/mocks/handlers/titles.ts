import { http } from 'msw'
import type { CharacterTitleRead } from '@/api/generated'

// Mock titles data
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
      title.is_equipped = title.id === titleId
    })
    
    return Response.json({ success: true })
  }),

  // Unequip all titles
  http.put(`${API_BASE_URL}/api/v1/titles/unequip-all`, () => {
    // Update mock data
    mockTitles.forEach(title => {
      title.is_equipped = false
    })
    
    return Response.json({ success: true })
  })
]