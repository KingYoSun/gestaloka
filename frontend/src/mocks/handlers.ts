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
  http.get('*/api/v1/logs/fragments/:characterId', ({ params }) => {
    return HttpResponse.json([])
  }),

  http.get('*/api/v1/logs/completed/:characterId', ({ params }) => {
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

  // 探索マップデータ
  http.get('*/api/v1/exploration/:characterId/map-data', ({ params }) => {
    return HttpResponse.json({
      character_id: params.characterId,
      layers: [
        {
          layer: 1,
          locations: [
            {
              id: '1',
              name: '始まりの街',
              coordinates: { x: 0, y: 0 },
              type: 'city',
              danger_level: 'safe',
              is_discovered: true,
              exploration_percentage: 100,
              last_visited: '2025-01-01T00:00:00Z',
            },
            {
              id: '2',
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
              from_location_id: '1',
              to_location_id: '2',
              path_type: 'direct',
              is_one_way: false,
              is_discovered: true,
              sp_cost: 10,
            },
          ],
          exploration_progress: [
            {
              id: '1',
              character_id: params.characterId,
              location_id: '1',
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
          location_id: '1',
          timestamp: '2025-01-01T00:00:00Z',
          layer: 1,
          coordinates: { x: 0, y: 0 },
        },
      ],
      current_location: {
        id: '1',
        layer: 1,
        coordinates: { x: 0, y: 0 },
      },
    })
  }),

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
