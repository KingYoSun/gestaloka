import React from 'react'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

import { AuthProvider } from '@/features/auth/AuthProvider'
import { WebSocketProvider } from '@/providers/WebSocketProvider'
import { useAuth } from '@/features/auth/useAuth'
import '@/types/router'

// React Query設定
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5分
      retry: (failureCount, error: unknown) => {
        if (error && typeof error === 'object' && 'status' in error) {
          const statusError = error as { status?: number }
          if (statusError.status === 401 || statusError.status === 403) {
            return false
          }
        }
        return failureCount < 3
      },
    },
  },
})

function RootComponent() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <InnerRoot />
      </AuthProvider>
      <ReactQueryDevtools initialIsOpen={false} />
      <TanStackRouterDevtools />
    </QueryClientProvider>
  )
}

const AuthContext = React.createContext<any>(null)

export function useRouterAuth() {
  const context = React.useContext(AuthContext)
  if (!context) {
    throw new Error('useRouterAuth must be used within AuthContext')
  }
  return context
}

function InnerRoot() {
  const auth = useAuth()

  return (
    <AuthContext.Provider value={auth}>
      <WebSocketProvider>
        <div className="min-h-screen bg-background text-foreground">
          <Outlet />
        </div>
      </WebSocketProvider>
    </AuthContext.Provider>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
})
