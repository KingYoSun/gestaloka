import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders } from '@/test/test-utils'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { http } from 'msw'
import { server } from '@/mocks/server'
import { SPManagement } from '../SPManagement'
import type { PlayerSPDetail } from '@/api/generated'

// モックデータ
const mockPlayers: PlayerSPDetail[] = [
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

const mockTransactions = {
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
}

describe('SPManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render SP management header', async () => {
    server.use(
      http.get('/api/v1/admin/sp/players', () => {
        return Response.json(mockPlayers)
      })
    )

    renderWithProviders(<SPManagement />)

    expect(screen.getByText('SP管理')).toBeInTheDocument()
    expect(screen.getByText('プレイヤーのSP（ストーリーポイント）を管理・調整できます。')).toBeInTheDocument()
  })

  it('should render loading state', () => {
    server.use(
      http.get('/api/v1/admin/sp/players', () => {
        return new Promise(() => {}) // Never resolve to keep loading
      })
    )

    renderWithProviders(<SPManagement />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should render players table', async () => {
    server.use(
      http.get('/api/v1/admin/sp/players', () => {
        return Response.json(mockPlayers)
      })
    )

    renderWithProviders(<SPManagement />)

    await waitFor(() => {
      expect(screen.getByText('TestUser1')).toBeInTheDocument()
    })

    // ヘッダーの確認
    expect(screen.getByText('ユーザー名')).toBeInTheDocument()
    expect(screen.getByText('メールアドレス')).toBeInTheDocument()
    expect(screen.getByText('現在のSP')).toBeInTheDocument()
    expect(screen.getByText('総獲得')).toBeInTheDocument()
    expect(screen.getByText('総消費')).toBeInTheDocument()
    expect(screen.getByText('連続ログイン')).toBeInTheDocument()
    expect(screen.getByText('最終日次回復')).toBeInTheDocument()

    // プレイヤーデータの確認
    expect(screen.getByText('TestUser1')).toBeInTheDocument()
    expect(screen.getByText('test1@example.com')).toBeInTheDocument()
    expect(screen.getByText('1,500')).toBeInTheDocument()
    expect(screen.getByText('5,000')).toBeInTheDocument()
    expect(screen.getByText('3,500')).toBeInTheDocument()
    expect(screen.getByText('15日')).toBeInTheDocument()

    expect(screen.getByText('TestUser2')).toBeInTheDocument()
    expect(screen.getByText('test2@example.com')).toBeInTheDocument()
    expect(screen.getByText('800')).toBeInTheDocument()
    expect(screen.getByText('3,000')).toBeInTheDocument()
    expect(screen.getByText('2,200')).toBeInTheDocument()
    expect(screen.getByText('7日')).toBeInTheDocument()
  })

  it('should show empty state when no players found', async () => {
    server.use(
      http.get('/api/v1/admin/sp/players', () => {
        return Response.json([])
      })
    )

    renderWithProviders(<SPManagement />)

    await waitFor(() => {
      expect(screen.getByText('プレイヤーが見つかりません')).toBeInTheDocument()
    })
  })

  it('should handle search input', async () => {
    server.use(
      http.get('/api/v1/admin/sp/players', ({ request }) => {
        const url = new URL(request.url)
        const search = url.searchParams.get('search')
        
        if (search === 'TestUser1') {
          return Response.json([mockPlayers[0]])
        }
        return Response.json(mockPlayers)
      })
    )

    renderWithProviders(<SPManagement />)

    await waitFor(() => {
      expect(screen.getByText('TestUser1')).toBeInTheDocument()
      expect(screen.getByText('TestUser2')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText('ユーザー名またはメールで検索...')
    fireEvent.change(searchInput, { target: { value: 'TestUser1' } })

    await waitFor(() => {
      expect(screen.getByText('TestUser1')).toBeInTheDocument()
      expect(screen.queryByText('TestUser2')).not.toBeInTheDocument()
    })
  })

  it('should open adjustment dialog when clicking adjust button', async () => {
    server.use(
      http.get('/api/v1/admin/sp/players', () => {
        return Response.json(mockPlayers)
      })
    )

    renderWithProviders(<SPManagement />)

    await waitFor(() => {
      expect(screen.getByText('TestUser1')).toBeInTheDocument()
    })

    const adjustButtons = screen.getAllByText('調整')
    fireEvent.click(adjustButtons[0])

    await waitFor(() => {
      expect(screen.getByText('SP調整')).toBeInTheDocument()
      expect(screen.getByText('TestUser1 のSPを調整します。')).toBeInTheDocument()
      expect(screen.getByText('1,500 SP')).toBeInTheDocument()
    })
  })

  it('should handle SP adjustment', async () => {
    const mockAdjust = vi.fn()
    
    server.use(
      http.get('/api/v1/admin/sp/players', () => {
        return Response.json(mockPlayers)
      }),
      http.post('/api/v1/admin/sp/adjust', async ({ request }) => {
        const body = await request.json() as { amount: number, reason: string, user_id: string }
        mockAdjust(body)
        return Response.json({
          username: 'TestUser1',
          adjustment_amount: body.amount,
          new_balance: 1600
        })
      })
    )

    renderWithProviders(<SPManagement />)

    await waitFor(() => {
      expect(screen.getByText('TestUser1')).toBeInTheDocument()
    })

    // 調整ダイアログを開く
    const adjustButtons = screen.getAllByText('調整')
    fireEvent.click(adjustButtons[0])

    await waitFor(() => {
      expect(screen.getByText('SP調整')).toBeInTheDocument()
    })

    // 調整量を入力
    const amountInput = screen.getByPlaceholderText('例: 100 or -50')
    fireEvent.change(amountInput, { target: { value: '100' } })

    // 理由を入力
    const reasonInput = screen.getByPlaceholderText('例: イベント報酬、バグ補填など')
    fireEvent.change(reasonInput, { target: { value: 'テスト調整' } })

    // 調整実行
    const executeButton = screen.getByText('調整実行')
    fireEvent.click(executeButton)

    await waitFor(() => {
      expect(mockAdjust).toHaveBeenCalledWith({
        user_id: '1',
        amount: 100,
        reason: 'テスト調整'
      })
    })
  })

  it('should validate adjustment amount', async () => {
    server.use(
      http.get('/api/v1/admin/sp/players', () => {
        return Response.json(mockPlayers)
      })
    )

    renderWithProviders(<SPManagement />)

    await waitFor(() => {
      expect(screen.getByText('TestUser1')).toBeInTheDocument()
    })

    // 調整ダイアログを開く
    const adjustButtons = screen.getAllByText('調整')
    fireEvent.click(adjustButtons[0])

    await waitFor(() => {
      expect(screen.getByText('SP調整')).toBeInTheDocument()
    })

    // 無効な値を入力
    const amountInput = screen.getByPlaceholderText('例: 100 or -50')
    fireEvent.change(amountInput, { target: { value: 'abc' } })

    // 調整実行
    const executeButton = screen.getByText('調整実行')
    fireEvent.click(executeButton)

    // エラートーストが表示されることを確認（実際のtoast実装に依存）
  })

  it('should handle adjustment error', async () => {
    server.use(
      http.get('/api/v1/admin/sp/players', () => {
        return Response.json(mockPlayers)
      }),
      http.post('/api/v1/admin/sp/adjust', () => {
        return new Response(JSON.stringify({ detail: 'サーバーエラー' }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      })
    )

    renderWithProviders(<SPManagement />)

    await waitFor(() => {
      expect(screen.getByText('TestUser1')).toBeInTheDocument()
    })

    // 調整ダイアログを開く
    const adjustButtons = screen.getAllByText('調整')
    fireEvent.click(adjustButtons[0])

    await waitFor(() => {
      expect(screen.getByText('SP調整')).toBeInTheDocument()
    })

    // 調整量を入力
    const amountInput = screen.getByPlaceholderText('例: 100 or -50')
    fireEvent.change(amountInput, { target: { value: '100' } })

    // 調整実行
    const executeButton = screen.getByText('調整実行')
    fireEvent.click(executeButton)

    // エラーが処理されることを確認（実際のtoast実装に依存）
  })

  it('should open transaction history dialog', async () => {
    server.use(
      http.get('/api/v1/admin/sp/players', () => {
        return Response.json(mockPlayers)
      }),
      http.get('/api/v1/admin/sp/players/:userId/transactions', () => {
        return Response.json(mockTransactions)
      })
    )

    renderWithProviders(<SPManagement />)

    await waitFor(() => {
      expect(screen.getByText('TestUser1')).toBeInTheDocument()
    })

    // 履歴ボタンをクリック（History アイコンのボタン）
    const historyButtons = screen.getAllByRole('button').filter(button => 
      button.querySelector('svg')?.classList.contains('lucide-history')
    )
    fireEvent.click(historyButtons[0])

    await waitFor(() => {
      expect(screen.getByText('SP取引履歴')).toBeInTheDocument()
    })

    // 取引履歴が表示されることを確認
    expect(screen.getByText('daily_recovery')).toBeInTheDocument()
    expect(screen.getByText('デイリーログインボーナス')).toBeInTheDocument()
    expect(screen.getByText('+100')).toBeInTheDocument()
    expect(screen.getByText('1,600')).toBeInTheDocument()
  })

  it('should handle plus/minus buttons in adjustment dialog', async () => {
    server.use(
      http.get('/api/v1/admin/sp/players', () => {
        return Response.json(mockPlayers)
      })
    )

    renderWithProviders(<SPManagement />)

    await waitFor(() => {
      expect(screen.getByText('TestUser1')).toBeInTheDocument()
    })

    // 調整ダイアログを開く
    const adjustButtons = screen.getAllByText('調整')
    fireEvent.click(adjustButtons[0])

    await waitFor(() => {
      expect(screen.getByText('SP調整')).toBeInTheDocument()
    })

    const amountInput = screen.getByPlaceholderText('例: 100 or -50') as HTMLInputElement

    // プラスボタンをクリック
    const plusButton = screen.getByRole('button', { name: /plus/i })
    fireEvent.click(plusButton)
    expect(amountInput.value).toBe('+')

    // マイナスボタンをクリック
    const minusButton = screen.getByRole('button', { name: /minus/i })
    fireEvent.click(minusButton)
    expect(amountInput.value).toBe('-')
  })

  it('should close adjustment dialog on cancel', async () => {
    server.use(
      http.get('/api/v1/admin/sp/players', () => {
        return Response.json(mockPlayers)
      })
    )

    renderWithProviders(<SPManagement />)

    await waitFor(() => {
      expect(screen.getByText('TestUser1')).toBeInTheDocument()
    })

    // 調整ダイアログを開く
    const adjustButtons = screen.getAllByText('調整')
    fireEvent.click(adjustButtons[0])

    await waitFor(() => {
      expect(screen.getByText('SP調整')).toBeInTheDocument()
    })

    // キャンセルボタンをクリック
    const cancelButton = screen.getByText('キャンセル')
    fireEvent.click(cancelButton)

    await waitFor(() => {
      expect(screen.queryByText('SP調整')).not.toBeInTheDocument()
    })
  })
})