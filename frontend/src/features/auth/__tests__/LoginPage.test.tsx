import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginPage } from '../LoginPage'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from '@tanstack/react-router'
import { mockUser } from '@/mocks/fixtures/user'

// AuthProviderのモック
vi.mock('../AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
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

// RouterのNavigateモック
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router')
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

    expect(screen.getByLabelText(/メールアドレス/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/パスワード/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ログイン/i })).toBeInTheDocument()
    expect(screen.getByText(/アカウントをお持ちでない方/i)).toBeInTheDocument()
  })

  it('should handle successful login', async () => {
    mockLogin.mockResolvedValue(undefined)
    
    renderLoginPage()

    const emailInput = screen.getByLabelText(/メールアドレス/i)
    const passwordInput = screen.getByLabelText(/パスワード/i)
    const submitButton = screen.getByRole('button', { name: /ログイン/i })

    await user.type(emailInput, 'test@example.com')
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
      expect(screen.getByText(/メールアドレスを入力してください/i)).toBeInTheDocument()
      expect(screen.getByText(/パスワードを入力してください/i)).toBeInTheDocument()
    })

    expect(mockLogin).not.toHaveBeenCalled()
  })

  it('should show validation error for invalid email', async () => {
    renderLoginPage()

    const emailInput = screen.getByLabelText(/メールアドレス/i)
    const passwordInput = screen.getByLabelText(/パスワード/i)
    const submitButton = screen.getByRole('button', { name: /ログイン/i })

    await user.type(emailInput, 'invalid-email')
    await user.type(passwordInput, 'password123')
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/正しいメールアドレスを入力してください/i)).toBeInTheDocument()
    })

    expect(mockLogin).not.toHaveBeenCalled()
  })

  it('should handle login error', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid credentials'))
    
    renderLoginPage()

    const emailInput = screen.getByLabelText(/メールアドレス/i)
    const passwordInput = screen.getByLabelText(/パスワード/i)
    const submitButton = screen.getByRole('button', { name: /ログイン/i })

    await user.type(emailInput, 'test@example.com')
    await user.type(passwordInput, 'wrong-password')
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/ログインに失敗しました/i)).toBeInTheDocument()
    })
  })

  it('should disable form while logging in', async () => {
    mockLogin.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))
    
    renderLoginPage()

    const emailInput = screen.getByLabelText(/メールアドレス/i)
    const passwordInput = screen.getByLabelText(/パスワード/i)
    const submitButton = screen.getByRole('button', { name: /ログイン/i })

    await user.type(emailInput, 'test@example.com')
    await user.type(passwordInput, 'password123')
    await user.click(submitButton)

    expect(submitButton).toBeDisabled()
    expect(screen.getByText(/ログイン中.../i)).toBeInTheDocument()

    await waitFor(() => {
      expect(submitButton).not.toBeDisabled()
    })
  })

  it('should redirect to dashboard if already authenticated', () => {
    vi.mocked(vi.importActual('../useAuth')).useAuth = vi.fn().mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: mockUser,
    })

    renderLoginPage()

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/dashboard', replace: true })
  })
})