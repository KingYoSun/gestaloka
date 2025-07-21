import { Link, useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Users,
  Plus,
  Gamepad2,
  BookOpen,
  Target,
  PlayCircle,
} from 'lucide-react'
import { useGameSessions } from '@/hooks/useGameSessions'
import { useCharacters } from '@/hooks/useCharacters'
import type { Character } from '@/api/generated/models'

export function DashboardPage() {
  const navigate = useNavigate()
  const { data: charactersResponse } = useCharacters()
  const { data: sessions } = useGameSessions()
  
  // アクティブなセッションを取得（削除されたキャラクターのセッションは除外）
  const activeSessions =
    sessions?.sessions?.filter(session => {
      if (!session.isActive) return false
      // キャラクターが存在するセッションのみ表示
      const character = charactersResponse?.find((c: Character) => c.id === session.characterId)
      return !!character
    }) || []

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">ダッシュボード</h1>
        <p className="text-muted-foreground">
          ゲスタロカへようこそ！ここから冒険を始めましょう。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
              {activeSessions.length > 0 && (
                <Badge variant="default" className="ml-2">
                  {activeSessions.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeSessions.length > 0 ? (
              <div className="space-y-3">
                {activeSessions.slice(0, 3).map(session => {
                  const character = charactersResponse?.find(
                    (c: Character) => c.id === session.characterId
                  )
                  // キャラクターが見つからない場合はスキップ（二重チェック）
                  if (!character) return null

                  return (
                    <div
                      key={session.id}
                      className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                    >
                      <div>
                        <p className="text-sm font-medium">{character.name}</p>
                        <p className="text-xs text-muted-foreground">
                          ターン{' '}
                          {(() => {
                            if (
                              session.sessionData &&
                              typeof session.sessionData === 'object' &&
                              'turn_count' in session.sessionData
                            ) {
                              const turnCount = session.sessionData.turn_count
                              return typeof turnCount === 'number'
                                ? turnCount
                                : 0
                            }
                            return 0
                          })()}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate({ to: `/game/${session.id}` })}
                      >
                        <PlayCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  )
                })}
                {activeSessions.length > 3 && (
                  <p className="text-xs text-muted-foreground text-center">
                    他 {activeSessions.length - 3} 件のセッション
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                現在進行中のゲームセッションはありません
              </p>
            )}
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

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-orange-600" />
              クエスト管理
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              物語の目標を設定し、進行状況を確認します
            </p>
            <Link to="/quests" className="block">
              <Button variant="outline" className="w-full justify-start">
                <Target className="mr-2 h-4 w-4" />
                クエスト管理画面へ
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
