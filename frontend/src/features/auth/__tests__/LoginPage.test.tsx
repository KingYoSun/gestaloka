import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginPage } from '../LoginPage'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from '@/test/mocks/tanstack-router'
import { mockUser } from '@/mocks/fixtures/user'

// AuthProviderのモック
vi.mock('../AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// routesのモック
vi.mock('@/routes/login', () => ({
  Route: {
    useSearch: () => ({ redirect: null }),
  },
}))

// useAuthのモック
const mockLogin = vi.fn()
const mockNavigate = vi.fn()

vi.mock('../useAuth', () => ({
  useAuth: () => ({
    login: mockLogin,
    isAuthenticated: false,
    isLoading: false,
    user: null,
  }),
}))

// useNavigateのモック設定
vi.mock('@/test/mocks/tanstack-router', async () => {
  const actual = await vi.importActual('@/test/mocks/tanstack-router')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Navigate: () => null,
  }
})

const renderLoginPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  const router = createMemoryRouter({
    routeTree: {
      id: 'root',
      getRouteApi: () => ({} as any),
      addChildren: () => {},
      children: [],
      options: {},
    } as any,
    defaultPreload: 'intent',
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router}>
        <LoginPage />
      </RouterProvider>
    </QueryClientProvider>
  )
}

describe('LoginPage', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render login form', () => {
    renderLoginPage()

    expect(screen.getByLabelText(/ユーザー名/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/パスワード/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ログイン/i })).toBeInTheDocument()
    expect(screen.getByText(/アカウントをお持ちでない方/i)).toBeInTheDocument()
  })

  it('should handle successful login', async () => {
    mockLogin.mockResolvedValue(undefined)
    
    renderLoginPage()

    const usernameInput = screen.getByLabelText(/ユーザー名/i)
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

  it('should show validation errors for empty fields', async () => {
    renderLoginPage()

    const submitButton = screen.getByRole('button', { name: /ログイン/i })
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/ユーザー名を入力してください/i)).toBeInTheDocument()
      expect(screen.getByText(/パスワードを入力してください/i)).toBeInTheDocument()
    })

    expect(mockLogin).not.toHaveBeenCalled()
  })

  it('should show validation error for invalid email', async () => {
    renderLoginPage()

    const usernameInput = screen.getByLabelText(/ユーザー名/i)
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

    const usernameInput = screen.getByLabelText(/ユーザー名/i)
    const passwordInput = screen.getByLabelText(/パスワード/i)
    const submitButton = screen.getByRole('button', { name: /ログイン/i })

    await user.type(usernameInput, 'test@example.com')
    await user.type(passwordInput, 'wrong-password')
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/ログインに失敗しました/i)).toBeInTheDocument()
    })
  })

  it('should disable form while logging in', async () => {
    mockLogin.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))
    
    renderLoginPage()

    const usernameInput = screen.getByLabelText(/ユーザー名/i)
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