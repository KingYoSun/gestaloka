import { render, RenderOptions } from '@testing-library/react'
import { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryRouter } from '@tanstack/react-router'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { ValidationRulesProvider } from '@/contexts/ValidationRulesContext'

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialRoute?: string
  isAuthenticated?: boolean
}

const createTestQueryClient = () => {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

export function renderWithProviders(
  ui: ReactElement,
  options: CustomRenderOptions = {}
) {
  const { initialRoute = '/', isAuthenticated = false, ...renderOptions } = options

  const queryClient = createTestQueryClient()

  // 簡易的なルーター設定（実際のルートツリーは後で設定）
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

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ValidationRulesProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ValidationRulesProvider>
      </QueryClientProvider>
    )
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    queryClient,
  }
}

// Re-export everything
export * from '@testing-library/react'
export { renderWithProviders as render }