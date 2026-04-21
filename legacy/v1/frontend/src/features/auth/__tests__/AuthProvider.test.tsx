import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AuthProvider } from '../AuthProvider'
import { useAuth } from '../useAuth'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from '@/test/mocks/tanstack-router'
import { mockUser } from '@/mocks/fixtures/user'

// APIモック
vi.mock('@/lib/api', () => ({
  authApi: {
    getCurrentUserInfoApiV1AuthMeGet: vi.fn(),
  },
}))

// テスト用コンポーネント
function TestComponent() {
  const { user, isAuthenticated, isLoading } = useAuth()
  
  return (
    <div>
      <div data-testid="loading">{isLoading ? 'Loading' : 'Not Loading'}</div>
      <div data-testid="authenticated">{isAuthenticated ? 'Authenticated' : 'Not Authenticated'}</div>
      <div data-testid="user">{user ? user.email : 'No User'}</div>
    </div>
  )
}

const createWrapper = () => {
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

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router}>
        {children}
      </RouterProvider>
    </QueryClientProvider>
  )
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    // console.errorをモック化してエラーメッセージを抑制
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should provide auth context to children', async () => {
    const { authApi } = await import('@/lib/api')
    vi.mocked(authApi.getCurrentUserInfoApiV1AuthMeGet).mockRejectedValue(
      new Error('No token')
    )
    
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('Not Loading')
      expect(screen.getByTestId('authenticated')).toHaveTextContent('Not Authenticated')
      expect(screen.getByTestId('user')).toHaveTextContent('No User')
    })
  })

  it('should initialize with authenticated user when token exists', async () => {
    localStorage.setItem('accessToken', 'existing-token')
    
    const { authApi } = await import('@/lib/api')
    vi.mocked(authApi.getCurrentUserInfoApiV1AuthMeGet).mockResolvedValue({
      data: mockUser,
    } as any)

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('Not Loading')
      expect(screen.getByTestId('authenticated')).toHaveTextContent('Authenticated')
      expect(screen.getByTestId('user')).toHaveTextContent(mockUser.email)
    })
  })

  it('should handle initialization error', async () => {
    localStorage.setItem('accessToken', 'invalid-token')
    
    const { authApi } = await import('@/lib/api')
    vi.mocked(authApi.getCurrentUserInfoApiV1AuthMeGet).mockRejectedValue(
      new Error('Unauthorized')
    )

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('Not Loading')
      expect(screen.getByTestId('authenticated')).toHaveTextContent('Not Authenticated')
      expect(screen.getByTestId('user')).toHaveTextContent('No User')
      expect(localStorage.getItem('accessToken')).toBeNull()
    })
  })

  it('should throw error when useAuth is used outside AuthProvider', () => {
    // コンソールエラーを一時的に無効化
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      render(<TestComponent />)
    }).toThrow('useAuth must be used within an AuthProvider')

    consoleSpy.mockRestore()
  })
})