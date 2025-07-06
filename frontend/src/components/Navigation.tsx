import { Link, useLocation, useRouter } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import {
  Home,
  User,
  GamepadIcon,
  ScrollText,
  Settings,
  LogOut,
  MapPin,
  Gem,
  Target,
  Sparkles,
  Crown,
} from 'lucide-react'
import { Button } from './ui/button'
import { useAuth } from '@/features/auth/useAuth'

const navigationItems = [
  {
    name: 'ダッシュボード',
    href: '/dashboard',
    icon: Home,
  },
  {
    name: 'キャラクター',
    href: '/characters',
    icon: User,
  },
  {
    name: 'セッション',
    href: '/game/start',
    icon: GamepadIcon,
  },
  {
    name: 'ログ',
    href: '/logs',
    icon: ScrollText,
  },
  {
    name: 'フラグメント',
    href: '/log-fragments',
    icon: Gem,
  },
  {
    name: 'クエスト',
    href: '/quests',
    icon: Target,
  },
  {
    name: '記憶継承',
    href: '/memory',
    icon: Sparkles,
  },
  {
    name: '称号',
    href: '/titles',
    icon: Crown,
  },
  {
    name: '探索',
    href: '/exploration',
    icon: MapPin,
  },
  {
    name: '設定',
    href: '/settings',
    icon: Settings,
  },
]

export function Navigation() {
  const location = useLocation()
  const router = useRouter()
  const { logout } = useAuth()

  const handleLogout = async () => {
    try {
      await logout()
      await router.navigate({ to: '/login' })
    } catch (error) {
      console.error('ログアウトエラー:', error)
    }
  }

  return (
    <nav className="relative w-64 h-full bg-muted/50 border-r border-border flex flex-col">
      <div className="p-6">
        <h1 className="text-2xl font-bold text-primary">ゲスタロカ</h1>
        <p className="text-sm text-muted-foreground mt-1">GESTALOKA</p>
      </div>

      <div className="px-3 flex-1 overflow-y-auto">
        <ul className="space-y-1">
          {navigationItems.map(item => {
            const isActive = location.pathname.startsWith(item.href)
            const Icon = item.icon

            return (
              <li key={item.name}>
                <Link
                  to={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all hover:bg-accent',
                    isActive && 'bg-accent text-accent-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.name}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>

      {/* ログアウトボタン */}
      <div className="p-3 mt-auto">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          ログアウト
        </Button>
      </div>
    </nav>
  )
}
