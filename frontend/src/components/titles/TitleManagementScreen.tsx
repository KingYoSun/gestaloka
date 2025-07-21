import { useTitleManagement } from '@/hooks/useTitles'
import { TitleCard } from './TitleCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Crown, X } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function TitleManagementScreen() {
  const {
    titles,
    equippedTitle,
    isLoading,
    isError,
    equipTitle,
    unequipAllTitles,
    isEquipping,
    isUnequipping,
  } = useTitleManagement()

  if (isLoading) {
    return (
      <div className="container max-w-6xl py-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="container max-w-6xl py-8">
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            称号の読み込みに失敗しました
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Crown className="h-8 w-8 text-yellow-500" />
            称号管理
          </h1>
          <p className="text-muted-foreground mt-1">
            獲得した称号を装備して、あなたの功績を示しましょう
          </p>
        </div>
      </div>

      {/* 装備中の称号 */}
      {equippedTitle && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">装備中の称号</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge variant="default" className="text-base py-1 px-3">
                  {equippedTitle.title}
                </Badge>
                <p className="text-sm text-muted-foreground">
                  {equippedTitle.description}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => unequipAllTitles()}
                disabled={isUnequipping}
              >
                <X className="h-4 w-4 mr-1" />
                外す
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 獲得済み称号一覧 */}
      <div>
        <h2 className="text-xl font-semibold mb-4">獲得済み称号</h2>
        {titles.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <Crown className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                まだ称号を獲得していません
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                ゲームを進めて称号を獲得しましょう
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {titles.map((title) => (
              <TitleCard
                key={title.id}
                title={title}
                isEquipped={equippedTitle?.id === title.id}
                onEquip={() => equipTitle(title.id)}
                onUnequip={() => {}} // 空の関数を渡す
                isEquipping={isEquipping}
              />
            ))}
          </div>
        )}
      </div>

      {/* 称号の説明 */}
      <Card>
        <CardHeader>
          <CardTitle>称号について</CardTitle>
          <CardDescription>
            称号はゲーム内での功績に応じて獲得できます
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <h3 className="font-medium mb-1">獲得方法</h3>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>特定のクエストをクリアする</li>
              <li>一定の条件を達成する</li>
              <li>イベントに参加する</li>
              <li>ログを編纂・派遣する</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium mb-1">効果</h3>
            <p className="text-sm text-muted-foreground">
              称号を装備すると、キャラクター名の横に表示されます。
              他のプレイヤーにあなたの功績をアピールできます。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}