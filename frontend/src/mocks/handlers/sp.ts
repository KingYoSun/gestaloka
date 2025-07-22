import { http } from 'msw'
import type { SPBalanceRead } from '@/api/generated'

// Mock SP data
const mockBalance: SPBalanceRead = {
  current_sp: 1500,
  total_earned_sp: 5000,
  total_consumed_sp: 3500,
  consecutive_login_days: 15,
  has_active_subscription: false,
  subscription_end_date: null,
  subscription_type: null
}

const API_BASE_URL = 'http://localhost:8000'

export const spHandlers = [
  // Get SP balance
  http.get(`${API_BASE_URL}/api/v1/sp/balance`, () => {
    return Response.json(mockBalance)
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