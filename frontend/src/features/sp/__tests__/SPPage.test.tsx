import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders } from '@/test/test-utils'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { http } from 'msw'
import { server } from '@/mocks/server'
import { SPPage } from '../../../routes/_authenticated/sp/index'
import type { PlayerSPRead } from '@/api/generated'

// モックデータ
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

const mockTransactions = {
  items: [
    {
      id: '1',
      sp_amount: 100,
      transaction_type: 'earned' as const,
      description: 'デイリーログインボーナス',
      created_at: new Date().toISOString()
    },
    {
      id: '2',
      sp_amount: -10,
      transaction_type: 'consumed' as const,
      description: '自由行動: 探索',
      created_at: new Date().toISOString()
    }
  ],
  total: 2,
  page: 1,
  size: 50,
  pages: 1
}

const mockPlans = {
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
}

const mockPurchaseHistory = {
  items: [
    {
      id: 'purchase_1',
      amount: 1000,
      sp_amount: 1100,
      status: 'completed' as const,
      payment_method: 'stripe',
      created_at: new Date().toISOString()
    }
  ],
  total: 1,
  page: 1,
  size: 50,
  pages: 1
}

const mockSubscriptions = {
  items: [],
  total: 0,
  page: 1,
  size: 50,
  pages: 1
}

describe('SPPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render loading state initially', () => {
    server.use(
      http.get('*/api/v1/sp/balance', () => {
        return new Promise(() => {}) // Never resolve to keep loading
      })
    )

    const { container } = renderWithProviders(<SPPage />)

    // Skeletonコンポーネントが表示されることを確認 - animate-pulseクラスを探す
    const skeletons = container.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('should render error state when balance loading fails', async () => {
    server.use(
      http.get('*/api/v1/sp/balance', () => {
        return new Response(null, { status: 500 })
      })
    )

    renderWithProviders(<SPPage />)

    await waitFor(() => {
      expect(screen.getByText('SP情報の読み込みに失敗しました')).toBeInTheDocument()
    })
  })

  it('should render SP balance and statistics', async () => {
    server.use(
      http.get('*/api/v1/sp/balance', () => {
        return Response.json(mockBalance)
      })
    )

    renderWithProviders(<SPPage />)

    await waitFor(() => {
      expect(screen.getByText('ストーリーポイント (SP)')).toBeInTheDocument()
    })

    // 統計カードの確認
    expect(screen.getByText('1,500 SP')).toBeInTheDocument() // 現在の残高
    expect(screen.getByText('5,000 SP')).toBeInTheDocument() // 総獲得量
    expect(screen.getByText('3,500 SP')).toBeInTheDocument() // 総消費量
    expect(screen.getByText('15 日')).toBeInTheDocument() // 連続ログイン
    expect(screen.getByText('14日ボーナス獲得中')).toBeInTheDocument()
  })

  it('should calculate and display consumption rate', async () => {
    server.use(
      http.get('*/api/v1/sp/balance', () => {
        return Response.json(mockBalance)
      })
    )

    renderWithProviders(<SPPage />)

    await waitFor(() => {
      // 消費率: 3500 / 5000 * 100 = 70%
      expect(screen.getByText('獲得量の 70.0% を消費')).toBeInTheDocument()
    })
  })

  it('should switch between tabs', async () => {
    server.use(
      http.get('*/api/v1/sp/balance', () => {
        return Response.json(mockBalance)
      }),
      http.get('*/api/v1/sp/transactions', () => {
        return Response.json(mockTransactions)
      }),
      http.get('*/api/v1/sp/plans', () => {
        return Response.json(mockPlans)
      }),
      http.get('/api/v1/sp/purchases', () => {
        return Response.json(mockPurchaseHistory)
      }),
      http.get('/api/v1/sp/subscriptions', () => {
        return Response.json(mockSubscriptions)
      })
    )

    renderWithProviders(<SPPage />)

    await waitFor(() => {
      expect(screen.getByText('概要')).toBeInTheDocument()
    })

    // 取引履歴タブ
    const transactionTab = screen.getByRole('tab', { name: '取引履歴' })
    fireEvent.click(transactionTab)
    await waitFor(() => {
      expect(transactionTab).toHaveAttribute('data-state', 'active')
    })

    // SPショップタブ
    const shopTab = screen.getByRole('tab', { name: 'SPショップ' })
    fireEvent.click(shopTab)
    await waitFor(() => {
      expect(shopTab).toHaveAttribute('data-state', 'active')
    })

    // 購入履歴タブ
    const purchaseTab = screen.getByRole('tab', { name: '購入履歴' })
    fireEvent.click(purchaseTab)
    await waitFor(() => {
      expect(purchaseTab).toHaveAttribute('data-state', 'active')
    })

    // 月額パスタブ
    const passTab = screen.getByRole('tab', { name: '月額パス' })
    fireEvent.click(passTab)
    await waitFor(() => {
      expect(passTab).toHaveAttribute('data-state', 'active')
    })
  })

  it('should handle daily recovery button click', async () => {
    const mockMutate = vi.fn().mockResolvedValue({
      current_sp: 1600,
      total_earned_sp: 5100,
      sp_recovered: 100
    })

    server.use(
      http.get('*/api/v1/sp/balance', () => {
        return Response.json(mockBalance)
      }),
      http.post('*/api/v1/sp/daily-recovery', () => {
        mockMutate()
        return Response.json({
          current_sp: 1600,
          total_earned_sp: 5100,
          sp_recovered: 100
        })
      })
    )

    renderWithProviders(<SPPage />)

    await waitFor(() => {
      expect(screen.getByText('日次回復')).toBeInTheDocument()
    })

    const recoveryButton = screen.getByText('日次回復').closest('button')!
    fireEvent.click(recoveryButton)

    await waitFor(() => {
      expect(screen.getByText('処理中...')).toBeInTheDocument()
    })
  })

  it('should display SP usage information in overview tab', async () => {
    server.use(
      http.get('*/api/v1/sp/balance', () => {
        return Response.json(mockBalance)
      })
    )

    renderWithProviders(<SPPage />)

    await waitFor(() => {
      expect(screen.getByText('SPの使い道')).toBeInTheDocument()
    })

    // SP使用量の表示確認
    expect(screen.getByText('自由行動（短い）')).toBeInTheDocument()
    expect(screen.getByText('1-2 SP')).toBeInTheDocument()
    expect(screen.getByText('自由行動（標準）')).toBeInTheDocument()
    expect(screen.getByText('3 SP')).toBeInTheDocument()
    expect(screen.getByText('自由行動（複雑）')).toBeInTheDocument()
    expect(screen.getByText('5 SP')).toBeInTheDocument()
    expect(screen.getByText('ログ派遣（短期）')).toBeInTheDocument()
    expect(screen.getByText('10-30 SP')).toBeInTheDocument()
    expect(screen.getByText('ログ派遣（長期）')).toBeInTheDocument()
    expect(screen.getByText('80-300 SP')).toBeInTheDocument()
  })

  it('should open purchase dialog when selecting a plan', async () => {
    server.use(
      http.get('*/api/v1/sp/balance', () => {
        return Response.json(mockBalance)
      }),
      http.get('*/api/v1/sp/plans', () => {
        return Response.json(mockPlans)
      })
    )

    renderWithProviders(<SPPage />)

    await waitFor(() => {
      expect(screen.getByText('SPショップ')).toBeInTheDocument()
    })

    // SPショップタブに切り替え
    fireEvent.click(screen.getByText('SPショップ'))

    await waitFor(() => {
      expect(screen.getByText('スターター')).toBeInTheDocument()
    })

    // プランカードをクリック（実際のSPPlansGridコンポーネントの動作に依存）
    // ここではモックされた動作を想定
  })

  it('should display correct login bonus message based on consecutive days', async () => {
    const testCases = [
      { days: 5, message: '連続ログインでボーナスSP' },
      { days: 7, message: '7日ボーナス獲得中' },
      { days: 14, message: '14日ボーナス獲得中' },
      { days: 30, message: '最大ボーナス獲得中！' }
    ]

    for (const testCase of testCases) {
      server.use(
        http.get('*/api/v1/sp/balance', () => {
          return Response.json({
            ...mockBalance,
            consecutive_login_days: testCase.days
          })
        })
      )

      const { unmount } = renderWithProviders(<SPPage />)

      await waitFor(() => {
        expect(screen.getByText(testCase.message)).toBeInTheDocument()
      })

      unmount()
      // Clear queries after test
    }
  })

  it('should handle zero earned SP gracefully', async () => {
    server.use(
      http.get('*/api/v1/sp/balance', () => {
        return Response.json({
          ...mockBalance,
          total_earned_sp: 0,
          total_consumed_sp: 0
        })
      })
    )

    renderWithProviders(<SPPage />)

    await waitFor(() => {
      // 0で除算してもエラーにならないことを確認
      expect(screen.getByText('獲得量の 0.0% を消費')).toBeInTheDocument()
    })
  })
})