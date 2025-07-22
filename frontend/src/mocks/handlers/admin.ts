import { http } from 'msw'
import type { PlayerSPDetail, AdminSPAdjustmentResponse } from '@/api/generated'

// Mock admin data
const mockAdminSPPlayers: PlayerSPDetail[] = [
  {
    user_id: 1,
    username: 'TestUser1',
    email: 'test1@example.com',
    current_sp: 1500,
    total_earned: 5000,
    total_consumed: 3500,
    consecutive_login_days: 15,
    last_daily_recovery: new Date(),
    created_at: new Date(),
    updated_at: new Date()
  },
  {
    user_id: 2,
    username: 'TestUser2',
    email: 'test2@example.com',
    current_sp: 800,
    total_earned: 3000,
    total_consumed: 2200,
    consecutive_login_days: 7,
    last_daily_recovery: null,
    created_at: new Date(),
    updated_at: new Date()
  }
]

const API_BASE_URL = 'http://localhost:8000'

export const adminHandlers = [
  // Get all players SP data
  http.get(`${API_BASE_URL}/api/v1/admin/admin/sp/players`, ({ request }) => {
    const url = new URL(request.url)
    const search = url.searchParams.get('search')
    
    let filteredPlayers = mockAdminSPPlayers
    
    if (search) {
      filteredPlayers = mockAdminSPPlayers.filter(player => 
        player.username.toLowerCase().includes(search.toLowerCase()) ||
        player.email.toLowerCase().includes(search.toLowerCase())
      )
    }
    
    return Response.json(filteredPlayers)
  }),

  // Get player SP detail
  http.get(`${API_BASE_URL}/api/v1/admin/admin/sp/players/:userId`, ({ params }) => {
    const player = mockAdminSPPlayers.find(p => p.user_id === Number(params.userId))
    
    if (!player) {
      return new Response(null, { status: 404 })
    }
    
    return Response.json(player)
  }),

  // Get player transactions
  http.get(`${API_BASE_URL}/api/v1/admin/admin/sp/players/:userId/transactions`, () => {
    return Response.json({
      transactions: [
        {
          id: '1',
          user_id: '1',
          amount: 100,
          transaction_type: 'daily_recovery',
          description: 'デイリーログインボーナス',
          created_at: new Date(),
          balance_after: 1600
        },
        {
          id: '2',
          user_id: '1',
          amount: -10,
          transaction_type: 'game_action',
          description: '自由行動: 探索',
          created_at: new Date(),
          balance_after: 1590
        }
      ],
      total: 2
    })
  }),

  // Adjust player SP
  http.post(`${API_BASE_URL}/api/v1/admin/admin/sp/adjust`, async ({ request }) => {
    const body = await request.json() as { user_id: number; amount: number; reason: string }
    
    const response: AdminSPAdjustmentResponse = {
      user_id: body.user_id,
      username: 'TestUser1',
      previous_sp: 1500,
      current_sp: 1600,
      adjustment_amount: body.amount,
      reason: body.reason,
      adjusted_by: 'admin',
      adjusted_at: new Date()
    }
    
    return Response.json(response)
  }),

  // Batch adjust SP
  http.post(`${API_BASE_URL}/api/v1/admin/admin/sp/batch-adjust`, () => {
    return Response.json([])
  })
]