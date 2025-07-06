import { http, HttpResponse } from 'msw'

export const handlers = [
  // 認証関連
  http.get('*/api/v1/auth/me', () => {
    return HttpResponse.json({
      id: 'test-user-id',
      username: 'testuser',
      email: 'test@example.com',
      roles: ['user'],
    })
  }),

  // キャラクター関連
  http.get('*/api/v1/characters', () => {
    return HttpResponse.json([
      {
        id: 'test-character-id',
        name: 'Test Character',
        level: 1,
        experience: 0,
        health: 100,
        max_health: 100,
        mana: 50,
        max_mana: 50,
        player_id: 'test-user-id',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ])
  }),

  // ゲームセッション関連
  http.get('*/api/v1/game/sessions', () => {
    return HttpResponse.json({
      sessions: [],
      total: 0,
    })
  }),

  // SP関連
  http.get('*/api/v1/sp/balance', () => {
    return HttpResponse.json({
      player_id: 'test-user-id',
      total_sp: 100,
      free_sp: 80,
      purchased_sp: 20,
      last_recovery_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }),

  http.get('*/api/v1/sp/balance/summary', () => {
    return HttpResponse.json({
      total_sp: 100,
      free_sp: 80,
      purchased_sp: 20,
    })
  }),

  // ログ関連
  http.get('*/api/v1/logs/fragments/:characterId', () => {
    return HttpResponse.json([])
  }),

  http.get('*/api/v1/logs/completed/:characterId', () => {
    return HttpResponse.json([])
  }),

  // 設定関連
  http.get('*/api/v1/config/game', () => {
    return HttpResponse.json({
      sp_recovery_amount: 10,
      sp_recovery_interval_hours: 24,
      max_free_sp: 100,
      log_dispatch_cost: 20,
      log_creation_requirements: {
        min_fragments: 3,
        max_fragments: 10,
      },
    })
  }),

  http.get('*/api/v1/config/game/validation-rules', () => {
    return HttpResponse.json({
      character_name: {
        min_length: 2,
        max_length: 20,
        pattern: '^[a-zA-Z0-9_\\-]+$',
      },
      password: {
        min_length: 8,
        max_length: 128,
      },
    })
  }),

  // 探索関連のAPIは削除（セッション進行に統合）

  // 汎用的なフォールバック
  http.get('*', ({ request }) => {
    console.warn(`Unhandled GET request: ${request.url}`)
    return HttpResponse.json({})
  }),

  http.post('*', ({ request }) => {
    console.warn(`Unhandled POST request: ${request.url}`)
    return HttpResponse.json({})
  }),
]
