import React from 'react'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { Layout } from '@/components/Layout'
import { useRouterAuth } from './__root'
import '@/types/router'

export const Route = createFileRoute('/_authenticated')({
  component: AuthenticatedComponent,
})

function AuthenticatedComponent() {
  const auth = useRouterAuth()
  const navigate = Route.useNavigate()

  React.useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      navigate({
        to: '/login',
        search: {
          redirect: Route.path,
        },
      })
    }
  }, [auth.isLoading, auth.isAuthenticated, navigate])

  // ローディング中の場合
  if (auth.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        Loading...
      </div>
    )
  }

  // 認証されていない場合
  if (!auth.isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        Redirecting...
      </div>
    )
  }

  return (
    <Layout>
      <Outlet />
    </Layout>
  )
}
