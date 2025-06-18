import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

import { AuthProvider } from '@/features/auth/AuthProvider'
import { WebSocketProvider } from '@/providers/WebSocketProvider'
import { Layout } from '@/components/Layout'

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

export const Route = createRootRoute({
  component: () => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WebSocketProvider>
          <div className="min-h-screen bg-background text-foreground">
            <Layout>
              <Outlet />
            </Layout>
          </div>
        </WebSocketProvider>
      </AuthProvider>
      <ReactQueryDevtools initialIsOpen={false} />
      <TanStackRouterDevtools />
    </QueryClientProvider>
  ),
})
