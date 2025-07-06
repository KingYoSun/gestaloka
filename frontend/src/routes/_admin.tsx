import React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AdminLayout } from '@/features/admin/components/AdminLayout'
import { useRouterAuth } from './__root'
import '@/types/router'

export const Route = createFileRoute('/_admin')({
  component: AdminComponent,
})

function AdminComponent() {
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
    // TODO: 管理者権限チェックもここに追加
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

  return <AdminLayout />
}
