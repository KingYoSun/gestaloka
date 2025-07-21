import { vi } from 'vitest'
import React from 'react'

// TanStack Router用のモック実装
export const createMemoryRouter = vi.fn((options: any) => {
  const router = {
    state: {
      location: {
        pathname: '/',
        href: '/',
        search: '',
        searchStr: '',
        state: {},
        hash: '',
        key: '',
        routeId: '',
        maskedLocation: undefined,
      },
      matches: [],
      isLoading: false,
      isTransitioning: false,
      status: 'idle',
    },
    subscribe: vi.fn(() => () => {}),
    navigate: vi.fn(),
    buildLink: vi.fn(() => ({ href: '/' })),
    matchRoute: vi.fn(() => false),
    preloadRoute: vi.fn(),
    cleanCache: vi.fn(),
    load: vi.fn(),
    invalidate: vi.fn(),
    dehydrate: vi.fn(),
    hydrate: vi.fn(),
    history: {
      push: vi.fn(),
      replace: vi.fn(),
      go: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      block: vi.fn(),
      location: {
        pathname: '/',
        search: '',
        hash: '',
        state: null,
        key: '',
      },
    },
    options: options || {},
    routeTree: options?.routeTree || {
      id: 'root',
      getRouteApi: () => ({} as any),
      addChildren: () => {},
      children: [],
      options: {},
    },
    basepath: '',
    __store: {
      state: {},
      subscribe: vi.fn(),
    },
  }
  return router
})

export const RouterProvider = ({ children }: any) => {
  return React.createElement('div', { 'data-testid': 'router-provider' }, children)
}

export const useNavigate = vi.fn(() => vi.fn())
export const useLocation = vi.fn(() => ({
  pathname: '/',
  search: '',
  hash: '',
  state: null,
}))
export const useParams = vi.fn(() => ({}))
export const useSearch = vi.fn(() => ({}))
export const useRouter = vi.fn(() => ({
  navigate: vi.fn(),
}))

export const Link = React.forwardRef(({ children, ...props }: any, ref: any) => {
  return React.createElement('a', { ref, ...props }, children)
})

export const Outlet = () => null

export const createFileRoute = vi.fn((path: string) => (options: any) => ({
  validateSearch: options?.validateSearch,
  component: options?.component,
  loader: options?.loader,
  path,
}))