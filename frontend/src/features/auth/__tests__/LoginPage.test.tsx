import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginPage } from '../LoginPage'
import { renderWithProviders as render } from '@/test/test-utils'

// useNavigateのモック
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Link: ({ children, to }: any) => <a href={to}>{children}</a>,
  }
})

// routesのモック
vi.mock('@/routes/login', () => ({
  Route: {
    useSearch: () => ({ redirect: null }),
  },
}))

// useAuthのモック
const mockLogin = vi.fn()
vi.mock('../useAuth', () => ({
  useAuth: () => ({
    login: mockLogin,
    isAuthenticated: false,
    isLoading: false,
    user: null,
  }),
}))

const renderLoginPage = () => {
  return render(<LoginPage />)
}

describe('LoginPage', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render login form', async () => {
    renderLoginPage()

    // バリデーションルールの読み込みを待つ
    await waitFor(() => {
      expect(screen.getByLabelText(/ユーザー名/i)).toBeInTheDocument()
    })
    
    expect(screen.getByLabelText(/パスワード/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ログイン/i })).toBeInTheDocument()
    expect(screen.getByText(/アカウントをお持ちでない方/i)).toBeInTheDocument()
    expect(screen.getByText(/ゲスタロカへようこそ/i)).toBeInTheDocument()
  })

  it('should handle successful login', async () => {
    mockLogin.mockResolvedValue(undefined)
    
    renderLoginPage()

    // バリデーションルールの読み込みを待つ
    const usernameInput = await screen.findByLabelText(/ユーザー名/i)
    const passwordInput = screen.getByLabelText(/パスワード/i)
    const submitButton = screen.getByRole('button', { name: /ログイン/i })

    await user.type(usernameInput, 'test@example.com')
    await user.type(passwordInput, 'password123')
    await user.click(submitButton)

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123')
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/dashboard' })
    })
  })

  it('should not submit form with empty fields', async () => {
    renderLoginPage()

    // バリデーションルールの読み込みを待つ
    const submitButton = await screen.findByRole('button', { name: /ログイン/i })
    await user.click(submitButton)

    // HTML5 required属性により、フォームが送信されない
    expect(mockLogin).not.toHaveBeenCalled()
  })

  it.skip('should show validation error for invalid email', async () => {
    renderLoginPage()

    // バリデーションルールの読み込みを待つ
    const usernameInput = await screen.findByLabelText(/ユーザー名/i)
    const passwordInput = screen.getByLabelText(/パスワード/i)
    const submitButton = screen.getByRole('button', { name: /ログイン/i })

    await user.type(usernameInput, 'invalid-email')
    await user.type(passwordInput, 'password123')
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/正しいユーザー名を入力してください/i)).toBeInTheDocument()
    })

    expect(mockLogin).not.toHaveBeenCalled()
  })

  it('should handle login error', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid credentials'))
    
    renderLoginPage()

    // バリデーションルールの読み込みを待つ
    const usernameInput = await screen.findByLabelText(/ユーザー名/i)
    const passwordInput = screen.getByLabelText(/パスワード/i)
    const submitButton = screen.getByRole('button', { name: /ログイン/i })

    await user.type(usernameInput, 'test@example.com')
    await user.type(passwordInput, 'wrong-password')
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/Invalid credentials/i)).toBeInTheDocument()
    })
  })

  it('should handle network error', async () => {
    mockLogin.mockRejectedValue(new Error('ネットワークエラー'))
    
    renderLoginPage()

    // バリデーションルールの読み込みを待つ
    const usernameInput = await screen.findByLabelText(/ユーザー名/i)
    const passwordInput = screen.getByLabelText(/パスワード/i)
    const submitButton = screen.getByRole('button', { name: /ログイン/i })

    await user.type(usernameInput, 'test@example.com')
    await user.type(passwordInput, 'password123')
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/ネットワークエラー/i)).toBeInTheDocument()
    })
  })

  it('should disable form while logging in', async () => {
    mockLogin.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))
    
    renderLoginPage()

    // バリデーションルールの読み込みを待つ
    const usernameInput = await screen.findByLabelText(/ユーザー名/i)
    const passwordInput = screen.getByLabelText(/パスワード/i)
    const submitButton = screen.getByRole('button', { name: /ログイン/i })

    await user.type(usernameInput, 'test@example.com')
    await user.type(passwordInput, 'password123')
    await user.click(submitButton)

    expect(submitButton).toBeDisabled()
    expect(screen.getByText(/ログイン中.../i)).toBeInTheDocument()

    await waitFor(() => {
      expect(submitButton).not.toBeDisabled()
    })
  })

  it.skip('should redirect to dashboard if already authenticated', () => {
    // LoginPageコンポーネント自体には認証チェックロジックがないため、
    // ルーターレベルでのガードテストが必要
  })
})