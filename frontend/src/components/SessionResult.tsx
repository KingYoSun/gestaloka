/**
 * セッションリザルト表示コンポーネント
 */
import { useNavigate } from '@tanstack/react-router'
import { Trophy, Sparkles, ScrollText, Target } from 'lucide-react'
import { SessionResultResponse } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'

interface SessionResultProps {
  result: SessionResultResponse
  characterId: string
}

export function SessionResult({ result, characterId }: SessionResultProps) {
  const navigate = useNavigate()

  const handleNewSession = () => {
    navigate({
      to: '/dashboard',
      search: { 
        action: 'continue',
        characterId,
        previousSessionId: result.sessionId 
      },
    })
  }

  const handleReturnToDashboard = () => {
    navigate({ to: '/dashboard' })
  }

  return (
    <div className="container mx-auto max-w-4xl p-4 space-y-6">
      <Card className="border-primary/20">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Trophy className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-3xl">冒険の記録</CardTitle>
          <CardDescription>
            {formatDistanceToNow(new Date(result.createdAt), {
              addSuffix: true,
              locale: ja,
            })}に完了
          </CardDescription>
        </CardHeader>
      </Card>

      {/* ストーリーサマリー */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            物語の要約
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground leading-relaxed">
            {result.storySummary}
          </p>
        </CardContent>
      </Card>

      {/* 重要イベント */}
      {result.keyEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              重要な出来事
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {result.keyEvents.map((event, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span className="text-sm">{event}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* 獲得報酬 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            獲得した報酬
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 経験値 */}
          <div>
            <h4 className="font-semibold mb-2">経験値</h4>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-lg px-3 py-1">
                +{result.experienceGained} EXP
              </Badge>
            </div>
          </div>

          {/* スキル向上 */}
          {Object.keys(result.skillsImproved).length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="font-semibold mb-2">スキルの向上</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {Object.entries(result.skillsImproved).map(([skill, improvement]) => (
                    <Badge key={skill} variant="outline">
                      {skill} <span className="text-primary ml-1">+{improvement}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* アイテム */}
          {result.itemsAcquired.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="font-semibold mb-2">獲得アイテム</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {result.itemsAcquired.map((item, index) => (
                    <Badge key={index} variant="secondary">
                      {item}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 次回への引き継ぎ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            次の冒険へ
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            {result.continuationContext}
          </p>
          
          {result.unresolvedPlots.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="font-semibold mb-2">未解決の謎</h4>
                <ul className="space-y-1">
                  {result.unresolvedPlots.map((plot, index) => (
                    <li key={index} className="text-sm text-muted-foreground">
                      • {plot}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* アクションボタン */}
      <div className="flex justify-center gap-4 pt-4">
        <Button
          size="lg"
          onClick={handleNewSession}
          className="min-w-[200px]"
        >
          冒険を続ける
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={handleReturnToDashboard}
        >
          ダッシュボードへ
        </Button>
      </div>
    </div>
  )
}