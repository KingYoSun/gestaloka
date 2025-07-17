import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RegisterPage } from '../RegisterPage'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from '@/test/mocks/tanstack-router'
import { mockUser } from '@/mocks/fixtures/user'

// AuthProviderのモック
vi.mock('../AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// useAuthのモック
const mockRegister = vi.fn()
const mockNavigate = vi.fn()

vi.mock('../useAuth', () => ({
  useAuth: () => ({
    register: mockRegister,
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

// routesのモック
vi.mock('@/routes/register', () => ({
  Route: {
    useSearch: () => ({ redirect: null }),
  },
}))

const renderRegisterPage = () => {
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
        <RegisterPage />
      </RouterProvider>
    </QueryClientProvider>
  )
}

describe('RegisterPage', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render register form', () => {
    renderRegisterPage()

    expect(screen.getByLabelText(/メールアドレス/i)).toBeInTheDocument()
    expect(screen.getByLabelText('パスワード')).toBeInTheDocument()
    expect(screen.getByLabelText(/パスワード（確認）/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /登録/i })).toBeInTheDocument()
    expect(screen.getByText(/既にアカウントをお持ちの方/i)).toBeInTheDocument()
  })

  it('should handle successful registration', async () => {
    mockRegister.mockResolvedValue(undefined)
    
    renderRegisterPage()

    const emailInput = screen.getByLabelText(/メールアドレス/i)
    const passwordInput = screen.getByLabelText('パスワード')
    const confirmPasswordInput = screen.getByLabelText(/パスワード（確認）/i)
    const submitButton = screen.getByRole('button', { name: /登録/i })

    await user.type(emailInput, 'newuser@example.com')
    await user.type(passwordInput, 'password123')
    await user.type(confirmPasswordInput, 'password123')
    await user.click(submitButton)

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('newuser@example.com', 'password123')
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/dashboard' })
    })
  })

  it('should show validation errors for empty fields', async () => {
    renderRegisterPage()

    const submitButton = screen.getByRole('button', { name: /登録/i })
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/メールアドレスを入力してください/i)).toBeInTheDocument()
      expect(screen.getByText(/パスワードを入力してください/i)).toBeInTheDocument()
      expect(screen.getByText(/パスワード（確認）を入力してください/i)).toBeInTheDocument()
    })

    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('should show validation error for invalid email', async () => {
    renderRegisterPage()

    const emailInput = screen.getByLabelText(/メールアドレス/i)
    const passwordInput = screen.getByLabelText('パスワード')
    const confirmPasswordInput = screen.getByLabelText(/パスワード（確認）/i)
    const submitButton = screen.getByRole('button', { name: /登録/i })

    await user.type(emailInput, 'invalid-email')
    await user.type(passwordInput, 'password123')
    await user.type(confirmPasswordInput, 'password123')
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/正しいメールアドレスを入力してください/i)).toBeInTheDocument()
    })

    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('should show error when passwords do not match', async () => {
    renderRegisterPage()

    const emailInput = screen.getByLabelText(/メールアドレス/i)
    const passwordInput = screen.getByLabelText('パスワード')
    const confirmPasswordInput = screen.getByLabelText(/パスワード（確認）/i)
    const submitButton = screen.getByRole('button', { name: /登録/i })

    await user.type(emailInput, 'newuser@example.com')
    await user.type(passwordInput, 'password123')
    await user.type(confirmPasswordInput, 'different-password')
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/パスワードが一致しません/i)).toBeInTheDocument()
    })

    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('should show error for short password', async () => {
    renderRegisterPage()

    const emailInput = screen.getByLabelText(/メールアドレス/i)
    const passwordInput = screen.getByLabelText('パスワード')
    const confirmPasswordInput = screen.getByLabelText(/パスワード（確認）/i)
    const submitButton = screen.getByRole('button', { name: /登録/i })

    await user.type(emailInput, 'newuser@example.com')
    await user.type(passwordInput, 'short')
    await user.type(confirmPasswordInput, 'short')
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/パスワードは8文字以上で入力してください/i)).toBeInTheDocument()
    })

    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('should handle registration error', async () => {
    mockRegister.mockRejectedValue(new Error('Email already exists'))
    
    renderRegisterPage()

    const emailInput = screen.getByLabelText(/メールアドレス/i)
    const passwordInput = screen.getByLabelText('パスワード')
    const confirmPasswordInput = screen.getByLabelText(/パスワード（確認）/i)
    const submitButton = screen.getByRole('button', { name: /登録/i })

    await user.type(emailInput, 'existing@example.com')
    await user.type(passwordInput, 'password123')
    await user.type(confirmPasswordInput, 'password123')
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/登録に失敗しました/i)).toBeInTheDocument()
    })
  })

  it('should disable form while registering', async () => {
    mockRegister.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))
    
    renderRegisterPage()

    const emailInput = screen.getByLabelText(/メールアドレス/i)
    const passwordInput = screen.getByLabelText('パスワード')
    const confirmPasswordInput = screen.getByLabelText(/パスワード（確認）/i)
    const submitButton = screen.getByRole('button', { name: /登録/i })

    await user.type(emailInput, 'newuser@example.com')
    await user.type(passwordInput, 'password123')
    await user.type(confirmPasswordInput, 'password123')
    await user.click(submitButton)

    expect(submitButton).toBeDisabled()
    expect(screen.getByText(/登録中.../i)).toBeInTheDocument()

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

    renderRegisterPage()

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/dashboard', replace: true })
  })
})