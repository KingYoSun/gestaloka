/**
 * 探索システムメインページ
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LocationMap } from './components/LocationMap'
import { CurrentLocationInfo } from './components/CurrentLocationInfo'
import { AvailableLocations } from './components/AvailableLocations'
import { ExplorationAreas } from './components/ExplorationAreas'
import { Minimap } from './minimap'

export function ExplorationPage() {
  // TODO: キャラクターIDを適切に取得する
  const characterId = 'temp-character-id'
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">探索</h1>
        <p className="text-muted-foreground">
          ゲスタロカの世界を探索し、新たな場所を発見しましょう
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左側：現在地情報 */}
        <div className="lg:col-span-1 space-y-6">
          <CurrentLocationInfo />
        </div>

        {/* 右側：マップとタブ */}
        <div className="lg:col-span-2 space-y-6">
          <LocationMap />

          <Tabs defaultValue="move" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="move">移動</TabsTrigger>
              <TabsTrigger value="explore">探索</TabsTrigger>
            </TabsList>

            <TabsContent value="move" className="space-y-4">
              <AvailableLocations />
            </TabsContent>

            <TabsContent value="explore" className="space-y-4">
              <ExplorationAreas />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* ミニマップ */}
      <Minimap characterId={characterId} />
    </div>
  )
}
