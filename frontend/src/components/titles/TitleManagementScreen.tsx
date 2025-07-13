/**
 * Title management screen component
 */
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Trophy, Crown, Info } from 'lucide-react'
import { useTitleManagement } from '@/hooks/useTitles'
import { TitleCard } from './TitleCard'

export const TitleManagementScreen = () => {
  const {
    titles,
    equippedTitle,
    isLoading,
    error,
    equipTitle,
    unequipAllTitles,
    isEquipping,
    isUnequipping,
  } = useTitleManagement()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>称号の読み込みに失敗しました。</AlertDescription>
      </Alert>
    )
  }

  // Separate titles by equipped status
  const unequippedTitles = titles.filter((t: any) => !t.is_equipped)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">称号管理</h1>
        <p className="text-muted-foreground mt-2">
          獲得した称号を管理し、装備する称号を選択できます
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">獲得称号数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-muted-foreground" />
              <span className="text-2xl font-bold">{titles.length}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">装備中の称号</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              <span className="text-lg font-semibold">
                {equippedTitle ? equippedTitle.title : 'なし'}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">称号効果</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">
              {equippedTitle?.effects &&
              Object.keys(equippedTitle.effects).length > 0 ? (
                Object.entries(equippedTitle.effects).map(([key, value]: [string, any]) => (
                  <p key={key}>
                    {key}: {value}
                  </p>
                ))
              ) : (
                <p>称号を装備すると効果が表示されます</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Title Tabs */}
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="all">すべての称号</TabsTrigger>
          <TabsTrigger value="equipped">装備中</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          {titles.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Trophy className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium">
                  まだ称号を獲得していません
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  ログ編纂や記憶継承で特殊称号を獲得できます
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {equippedTitle && (
                <div className="mb-6">
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Crown className="h-5 w-5 text-primary" />
                    装備中の称号
                  </h3>
                  <TitleCard
                    title={equippedTitle}
                    isEquipped={true}
                    onEquip={equipTitle}
                    onUnequip={unequipAllTitles}
                    isEquipping={isEquipping}
                    isUnequipping={isUnequipping}
                  />
                </div>
              )}

              {unequippedTitles.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">獲得済みの称号</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    {unequippedTitles.map((title: any) => (
                      <TitleCard
                        key={title.id}
                        title={title}
                        isEquipped={false}
                        onEquip={equipTitle}
                        onUnequip={unequipAllTitles}
                        isEquipping={isEquipping}
                        isUnequipping={isUnequipping}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="equipped" className="space-y-4">
          {equippedTitle ? (
            <TitleCard
              title={equippedTitle}
              isEquipped={true}
              onEquip={equipTitle}
              onUnequip={unequipAllTitles}
              isEquipping={isEquipping}
              isUnequipping={isUnequipping}
            />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Crown className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium">称号を装備していません</p>
                <p className="text-sm text-muted-foreground mt-2">
                  「すべての称号」タブから称号を選んで装備してください
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Info */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>称号について:</strong>{' '}
          称号は編纂コンボや記憶継承で獲得できます。
          装備した称号はプロフィールに表示され、特定の効果を発揮します。
        </AlertDescription>
      </Alert>
    </div>
  )
}
