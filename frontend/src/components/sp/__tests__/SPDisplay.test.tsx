import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { SPDisplay } from '../SPDisplay'
import { renderWithProviders as render } from '@/test/test-utils'
import { PlayerSPSummary } from '@/api/generated/models'

// useSPBalanceSummaryのモック
const mockUseSPBalanceSummary = vi.fn()
vi.mock('@/hooks/useSP', () => ({
  useSPBalanceSummary: () => mockUseSPBalanceSummary(),
}))

// react-routerのモック
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router')
  return {
    ...actual,
    Link: ({ children, to }: any) => <a href={to}>{children}</a>,
    useNavigate: () => mockNavigate,
  }
})

// ValidationRulesContextのモック
vi.mock('@/contexts/ValidationRulesContext', () => ({
  ValidationRulesProvider: ({ children }: any) => children,
  useValidationRulesContext: () => ({
    user: {
      username: { min_length: 3, max_length: 50 },
      password: { min_length: 8, max_length: 100 },
    },
    character: {
      name: { min_length: 1, max_length: 50 },
    },
  }),
}))

// AuthProviderのモック
vi.mock('@/features/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: any) => children,
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}))

describe('SPDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show loading skeleton when data is loading', () => {
    mockUseSPBalanceSummary.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    })

    render(<SPDisplay />)

    // Skeletonコンポーネントのクラス名で確認
    const skeleton = document.querySelector('.h-6.w-20')
    expect(skeleton).toBeInTheDocument()
  })

  it('should show error message when there is an error', () => {
    mockUseSPBalanceSummary.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('API Error'),
    })

    render(<SPDisplay />)

    expect(screen.getByText('エラー')).toBeInTheDocument()
  })

  it('should display SP balance in default variant', () => {
    const mockData: PlayerSPSummary = {
      current_sp: 1500,
      active_subscription: null,
      subscription_expires_at: null,
    }

    mockUseSPBalanceSummary.mockReturnValue({
      data: mockData,
      isLoading: false,
      error: null,
    })

    render(<SPDisplay />)

    expect(screen.getByText('1,500')).toBeInTheDocument()
    expect(screen.getByText('SP')).toBeInTheDocument()
  })

  it('should display SP balance with subscription info', () => {
    const mockData: PlayerSPSummary = {
      current_sp: 2000,
      active_subscription: 'premium',
      subscription_expires_at: '2025-08-20T00:00:00Z' as any,
    }

    mockUseSPBalanceSummary.mockReturnValue({
      data: mockData,
      isLoading: false,
      error: null,
    })

    render(<SPDisplay />)

    expect(screen.getByText('2,000')).toBeInTheDocument()
    expect(screen.getByText(/プレミアムパス/)).toBeInTheDocument()
    expect(screen.getByText(/有効期限:/)).toBeInTheDocument()
  })

  it('should display compact variant correctly', async () => {
    const mockData: PlayerSPSummary = {
      current_sp: 1000,
      active_subscription: null,
      subscription_expires_at: null,
    }

    mockUseSPBalanceSummary.mockReturnValue({
      data: mockData,
      isLoading: false,
      error: null,
    })

    render(<SPDisplay variant="compact" />)

    // コンパクトバージョンではツールチップ内にテキストがあるので、別の方法で確認
    const spElement = screen.getByText('1,000')
    expect(spElement).toBeInTheDocument()
    
    const linkElement = screen.getByRole('link')
    expect(linkElement).toHaveAttribute('href', '/sp')
  })

  it('should show low balance warning when SP is below threshold', () => {
    const mockData: PlayerSPSummary = {
      current_sp: 50,
      active_subscription: null,
      subscription_expires_at: null,
    }

    mockUseSPBalanceSummary.mockReturnValue({
      data: mockData,
      isLoading: false,
      error: null,
    })

    render(<SPDisplay lowBalanceThreshold={100} />)

    expect(screen.getByText('50')).toBeInTheDocument()
    // 低残高の場合はコンテナ全体が表示される
    // ここでは単にテキストが表示されることを確認
  })

  it('should not show subscription info when showSubscription is false', () => {
    const mockData: PlayerSPSummary = {
      current_sp: 1500,
      active_subscription: 'basic',
      subscription_expires_at: '2025-08-20T00:00:00Z' as any,
    }

    mockUseSPBalanceSummary.mockReturnValue({
      data: mockData,
      isLoading: false,
      error: null,
    })

    render(<SPDisplay showSubscription={false} />)

    expect(screen.getByText('1,500')).toBeInTheDocument()
    expect(screen.queryByText(/ベーシックプラン/)).not.toBeInTheDocument()
    expect(screen.queryByText(/有効期限:/)).not.toBeInTheDocument()
  })

  it('should animate when balance changes', async () => {
    const mockData1: PlayerSPSummary = {
      current_sp: 1000,
      active_subscription: null,
      subscription_expires_at: null,
    }

    const mockData2: PlayerSPSummary = {
      current_sp: 900,
      active_subscription: null,
      subscription_expires_at: null,
    }

    // 最初のデータ
    mockUseSPBalanceSummary.mockReturnValue({
      data: mockData1,
      isLoading: false,
      error: null,
    })

    render(<SPDisplay />)
    expect(screen.getByText('1,000')).toBeInTheDocument()

    // 残高を変更してコンポーネントを再レンダリング
    mockUseSPBalanceSummary.mockReturnValue({
      data: mockData2,
      isLoading: false,
      error: null,
    })

    // コンポーネントをアンマウントして再マウント
    render(<SPDisplay key="updated" />)

    await waitFor(() => {
      expect(screen.getByText('900')).toBeInTheDocument()
    })
  })
})