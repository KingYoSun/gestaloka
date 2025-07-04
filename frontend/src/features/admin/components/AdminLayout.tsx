import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Home, Activity, Users, Settings, LogOut, Coins } from 'lucide-react'

export function AdminLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    // Check if user is logged in
    // TODO: Add admin role check when roles are implemented
    if (!user) {
      navigate({ to: '/' })
    }
  }, [user, navigate])

  const handleLogout = () => {
    logout()
    navigate({ to: '/' })
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 bg-card border-r min-h-screen">
          <div className="p-6">
            <h2 className="text-2xl font-bold">管理画面</h2>
          </div>

          <nav className="px-4 space-y-2">
            <Link
              to="/admin"
              className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-accent transition-colors"
              activeProps={{
                className: 'bg-accent',
              }}
            >
              <Home className="w-5 h-5" />
              ダッシュボード
            </Link>

            <Link
              to="/admin/performance"
              className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-accent transition-colors"
              activeProps={{
                className: 'bg-accent',
              }}
            >
              <Activity className="w-5 h-5" />
              パフォーマンス
            </Link>

            <Link
              to={"/admin/sp" as any}
              className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-accent transition-colors"
              activeProps={{
                className: 'bg-accent',
              }}
            >
              <Coins className="w-5 h-5" />
              SP管理
            </Link>

            {/* 今後実装予定
            <Link
              to="/admin/users"
              className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-accent transition-colors disabled opacity-50 cursor-not-allowed"
              disabled
            >
              <Users className="w-5 h-5" />
              ユーザー管理
            </Link>
            
            <Link
              to="/admin/settings"
              className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-accent transition-colors disabled opacity-50 cursor-not-allowed"
              disabled
            >
              <Settings className="w-5 h-5" />
              設定
            </Link>
            */}

            <div className="flex items-center gap-3 px-4 py-2 rounded-lg opacity-50 cursor-not-allowed">
              <Users className="w-5 h-5" />
              <span className="text-sm">ユーザー管理（準備中）</span>
            </div>

            <div className="flex items-center gap-3 px-4 py-2 rounded-lg opacity-50 cursor-not-allowed">
              <Settings className="w-5 h-5" />
              <span className="text-sm">設定（準備中）</span>
            </div>
          </nav>

          <div className="absolute bottom-0 w-64 p-4 border-t">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{user.username}</p>
                <p className="text-xs text-muted-foreground">管理者</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                title="ログアウト"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
