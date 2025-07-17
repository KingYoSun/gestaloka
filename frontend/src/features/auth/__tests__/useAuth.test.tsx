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
    registerApiV1AuthRegisterPost: vi.fn(),
  },
  usersApi: {
    getCurrentUserApiV1UsersMeGet: vi.fn(),
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

  it('should initialize with loading state', () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(true)
    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.user).toBeNull()
  })

  it('should login successfully', async () => {
    const { authApi } = await import('@/lib/api')
    vi.mocked(authApi.loginApiV1AuthLoginPost).mockResolvedValue({
      access_token: 'mock-token',
      token_type: 'bearer',
    })

    const { usersApi } = await import('@/lib/api')
    vi.mocked(usersApi.getCurrentUserApiV1UsersMeGet).mockResolvedValue(mockUser)

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
    const { authApi, usersApi } = await import('@/lib/api')
    vi.mocked(authApi.loginApiV1AuthLoginPost).mockResolvedValue({
      access_token: 'mock-token',
      token_type: 'bearer',
    })
    vi.mocked(usersApi.getCurrentUserApiV1UsersMeGet).mockResolvedValue(mockUser)
    vi.mocked(authApi.logoutApiV1AuthLogoutPost).mockResolvedValue({})

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

  it('should register successfully', async () => {
    const { authApi, usersApi } = await import('@/lib/api')
    vi.mocked(authApi.registerApiV1AuthRegisterPost).mockResolvedValue(mockUser)
    vi.mocked(authApi.loginApiV1AuthLoginPost).mockResolvedValue({
      access_token: 'mock-token',
      token_type: 'bearer',
    })
    vi.mocked(usersApi.getCurrentUserApiV1UsersMeGet).mockResolvedValue(mockUser)

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    })

    await result.current.register('test@example.com', 'password123')

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true)
      expect(result.current.user).toEqual(mockUser)
    })
  })

  it('should restore session from localStorage', async () => {
    localStorage.setItem('accessToken', 'existing-token')
    
    const { usersApi } = await import('@/lib/api')
    vi.mocked(usersApi.getCurrentUserApiV1UsersMeGet).mockResolvedValue(mockUser)

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
    
    const { usersApi } = await import('@/lib/api')
    vi.mocked(usersApi.getCurrentUserApiV1UsersMeGet).mockRejectedValue(
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