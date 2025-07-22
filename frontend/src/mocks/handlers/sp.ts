import { http } from 'msw'
import type { PlayerSPRead } from '@/api/generated'

// Mock SP data
const mockBalance: PlayerSPRead = {
  id: '1',
  user_id: '1',
  current_sp: 1500,
  total_earned_sp: 5000,
  total_consumed_sp: 3500,
  total_purchased_sp: 0,
  total_purchase_amount: 0,
  active_subscription: null,
  subscription_expires_at: null,
  consecutive_login_days: 15,
  last_login_date: new Date('2025-01-22'),
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-22')
}

const API_BASE_URL = 'http://localhost:8000'

export const spHandlers = [
  // CORS preflight for balance summary
  http.options(`${API_BASE_URL}/api/v1/sp/balance/summary`, () => {
    return new Response(null, { status: 200 })
  }),
  // Get SP balance
  http.get(`${API_BASE_URL}/api/v1/sp/balance`, () => {
    return Response.json(mockBalance)
  }),

  // Get SP balance summary
  http.get(`${API_BASE_URL}/api/v1/sp/balance/summary`, () => {
    return Response.json({
      current_sp: 1500,
      total_earned_sp: 5000,
      total_consumed_sp: 3500,
      recent_transactions: [
        {
          id: '1',
          amount: 100,
          type: 'earned',
          description: 'デイリーログインボーナス',
          created_at: new Date().toISOString()
        },
        {
          id: '2',
          amount: -10,
          type: 'consumed',
          description: '自由行動: 探索',
          created_at: new Date().toISOString()
        }
      ],
      daily_recovery_available: false,
      consecutive_login_days: 15
    })
  }),

  // Daily recovery
  http.post(`${API_BASE_URL}/api/v1/sp/daily-recovery`, () => {
    return Response.json({
      current_sp: 1600,
      total_earned_sp: 5100,
      sp_recovered: 100
    })
  }),

  // Get SP transactions
  http.get(`${API_BASE_URL}/api/v1/sp/transactions`, () => {
    return Response.json({
      items: [
        {
          id: '1',
          sp_amount: 100,
          transaction_type: 'earned',
          description: 'デイリーログインボーナス',
          created_at: new Date().toISOString()
        },
        {
          id: '2',
          sp_amount: -10,
          transaction_type: 'consumed',
          description: '自由行動: 探索',
          created_at: new Date().toISOString()
        }
      ],
      total: 2,
      page: 1,
      size: 50,
      pages: 1
    })
  }),

  // Get SP plans
  http.get(`${API_BASE_URL}/api/v1/sp/plans`, () => {
    return Response.json({
      plans: [
        {
          id: 'plan_1',
          name: 'スターター',
          amount: 500,
          sp_amount: 500,
          bonus_sp: 0,
          description: '初心者向けプラン'
        },
        {
          id: 'plan_2',
          name: 'スタンダード',
          amount: 1000,
          sp_amount: 1000,
          bonus_sp: 100,
          description: '人気のプラン'
        }
      ],
      payment_mode: 'test'
    })
  }),

  // Get SP purchases
  http.get(`${API_BASE_URL}/api/v1/sp/purchases`, () => {
    return Response.json({
      items: [
        {
          id: 'purchase_1',
          amount: 1000,
          sp_amount: 1100,
          status: 'completed',
          payment_method: 'stripe',
          created_at: new Date().toISOString()
        }
      ],
      total: 1,
      page: 1,
      size: 50,
      pages: 1
    })
  }),

  // Get subscriptions
  http.get(`${API_BASE_URL}/api/v1/sp/subscriptions`, () => {
    return Response.json({
      items: [],
      total: 0,
      page: 1,
      size: 50,
      pages: 1
    })
  })
]