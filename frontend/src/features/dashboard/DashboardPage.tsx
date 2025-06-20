import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, Plus, Gamepad2, BookOpen } from 'lucide-react'

export function DashboardPage() {
  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">ダッシュボード</h1>
        <p className="text-muted-foreground">
          ゲスタロカへようこそ！ここから冒険を始めましょう。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-purple-600" />
              キャラクター管理
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              あなたのキャラクターを管理し、新しいキャラクターを作成しましょう
            </p>
            <div className="space-y-2">
              <Link to="/characters" className="block">
                <Button variant="outline" className="w-full justify-start">
                  <Users className="mr-2 h-4 w-4" />
                  キャラクター一覧
                </Button>
              </Link>
              <Link to="/character/create" className="block">
                <Button className="w-full justify-start">
                  <Plus className="mr-2 h-4 w-4" />
                  新規キャラクター作成
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gamepad2 className="h-5 w-5 text-blue-600" />
              進行中のセッション
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              現在進行中のゲームセッションはありません
            </p>
            <Button variant="outline" className="w-full" disabled>
              新しいセッションを開始
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-green-600" />
              ログシステム
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              キャラクターの記録を管理し、ログを編纂してNPCを作成します
            </p>
            <Link to="/logs" className="block">
              <Button className="w-full justify-start">
                <BookOpen className="mr-2 h-4 w-4" />
                ログ管理画面へ
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
