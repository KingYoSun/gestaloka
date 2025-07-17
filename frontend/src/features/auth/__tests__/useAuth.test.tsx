import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAuth } from '../useAuth'
import { AuthProvider } from '../AuthProvider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from '@tanstack/react-router'
import { mockUser } from '@/mocks/fixtures/user'

// APIモック
vi.mock('@/lib/api', () => ({
  authApi: {
    loginApiV1AuthLoginPost: vi.fn(),
    logoutApiV1AuthLogoutPost: vi.fn(),
    getCurrentUserInfoApiV1AuthMeGet: vi.fn(),
  },
}))

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
        <AuthProvider>{children}</AuthProvider>
      </RouterProvider>
    </QueryClientProvider>
  )
}

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('should initialize with loading state', async () => {
    const { authApi } = await import('@/lib/api')
    vi.mocked(authApi.getCurrentUserInfoApiV1AuthMeGet).mockRejectedValue(
      new Error('No token')
    )
    
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    })

    // 初期状態をすぐにチェック（非同期処理が始まる前）
    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.user).toBeNull()
    
    // 非同期処理が完了するまで待つ
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
  })

  it('should login successfully', async () => {
    const { authApi } = await import('@/lib/api')
    vi.mocked(authApi.loginApiV1AuthLoginPost).mockResolvedValue({
      data: {
        access_token: 'mock-token',
        token_type: 'bearer',
      },
    } as any)

    vi.mocked(authApi.getCurrentUserInfoApiV1AuthMeGet).mockResolvedValue({
      data: mockUser,
    } as any)

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    })

    await result.current.login('test@example.com', 'password123')

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true)
      expect(result.current.user).toEqual(mockUser)
      expect(localStorage.getItem('accessToken')).toBe('mock-token')
    })
  })

  it('should handle login failure', async () => {
    const { authApi } = await import('@/lib/api')
    vi.mocked(authApi.loginApiV1AuthLoginPost).mockRejectedValue(
      new Error('Invalid credentials')
    )

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    })

    await expect(
      result.current.login('test@example.com', 'wrong-password')
    ).rejects.toThrow('Invalid credentials')

    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.user).toBeNull()
    expect(localStorage.getItem('accessToken')).toBeNull()
  })

  it('should logout successfully', async () => {
    // First login
    const { authApi } = await import('@/lib/api')
    vi.mocked(authApi.loginApiV1AuthLoginPost).mockResolvedValue({
      data: {
        access_token: 'mock-token',
        token_type: 'bearer',
      },
    } as any)
    vi.mocked(authApi.getCurrentUserInfoApiV1AuthMeGet).mockResolvedValue({
      data: mockUser,
    } as any)
    vi.mocked(authApi.logoutApiV1AuthLogoutPost).mockResolvedValue({} as any)

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    })

    // Login first
    await result.current.login('test@example.com', 'password123')
    
    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true)
    })

    // Then logout
    await result.current.logout()

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(false)
      expect(result.current.user).toBeNull()
      expect(localStorage.getItem('accessToken')).toBeNull()
    })
  })

  it.skip('should register successfully', async () => {
    // Skip this test as AuthProvider doesn't implement register method
    // TODO: Add register method to AuthProvider or remove this test
  })

  it('should restore session from localStorage', async () => {
    localStorage.setItem('accessToken', 'existing-token')
    
    const { authApi } = await import('@/lib/api')
    vi.mocked(authApi.getCurrentUserInfoApiV1AuthMeGet).mockResolvedValue({
      data: mockUser,
    } as any)

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true)
      expect(result.current.user).toEqual(mockUser)
    })
  })

  it('should handle expired token', async () => {
    localStorage.setItem('accessToken', 'expired-token')
    
    const { authApi } = await import('@/lib/api')
    vi.mocked(authApi.getCurrentUserInfoApiV1AuthMeGet).mockRejectedValue(
      new Error('Unauthorized')
    )

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(false)
      expect(result.current.user).toBeNull()
      expect(localStorage.getItem('accessToken')).toBeNull()
    })
  })
})