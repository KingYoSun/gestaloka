import { http, HttpResponse } from 'msw'
import { mockCharacter, mockCharacters } from '../fixtures/character'
import type { CharacterCreate } from '@/api/generated/models'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'

export const charactersHandlers = [
  // キャラクター一覧取得
  http.get(`${API_BASE_URL}/characters`, () => {
    return HttpResponse.json(mockCharacters)
  }),

  // キャラクター詳細取得
  http.get(`${API_BASE_URL}/characters/:characterId`, ({ params }) => {
    const character = mockCharacters.find(c => c.id === params.characterId)
    
    if (character) {
      return HttpResponse.json(character)
    }
    
    return HttpResponse.json(
      { detail: 'Character not found' },
      { status: 404 }
    )
  }),

  // キャラクター作成
  http.post(`${API_BASE_URL}/characters`, async ({ request }) => {
    const body = await request.json() as CharacterCreate
    
    const newCharacter = {
      ...mockCharacter,
      id: `new-character-${Date.now()}`,
      name: body.name,
      stats: body.initial_stats,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    
    return HttpResponse.json(newCharacter, { status: 201 })
  }),

  // キャラクター更新
  http.put(`${API_BASE_URL}/characters/:characterId`, async ({ params, request }) => {
    const body = await request.json()
    const character = mockCharacters.find(c => c.id === params.characterId)
    
    if (character) {
      const updatedCharacter = {
        ...character,
        ...body,
        updated_at: new Date().toISOString(),
      }
      return HttpResponse.json(updatedCharacter)
    }
    
    return HttpResponse.json(
      { detail: 'Character not found' },
      { status: 404 }
    )
  }),

  // キャラクター削除
  http.delete(`${API_BASE_URL}/characters/:characterId`, ({ params }) => {
    const character = mockCharacters.find(c => c.id === params.characterId)
    
    if (character) {
      return HttpResponse.json({ message: 'Character deleted successfully' })
    }
    
    return HttpResponse.json(
      { detail: 'Character not found' },
      { status: 404 }
    )
  }),
]