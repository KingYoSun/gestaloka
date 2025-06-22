import { Bell, Menu } from 'lucide-react'
import { Button } from './ui/button'
import { WebSocketStatus } from './WebSocketStatus'
import { SPDisplay } from './sp/SPDisplay'

export function Header() {
  return (
    <header className="h-16 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">ようこそ、ゲスタロカへ</h2>
            <p className="text-sm text-muted-foreground">
              あなたの物語が世界を変える
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <SPDisplay variant="compact" />
          <WebSocketStatus />
          <Button variant="ghost" size="icon">
            <Bell className="h-5 w-5" />
          </Button>

          {/* ユーザーアバター（今後実装） */}
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-sm font-medium">U</span>
          </div>
        </div>
      </div>
    </header>
  )
}
