/**
 * 物語主導型探索インターフェース
 */

import React, { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Loader2, MapPin, Sparkles } from 'lucide-react'
import { useNarrativeActions } from './hooks/useNarrativeActions'
import { Minimap } from '@/features/exploration/minimap/Minimap'
import { ActionChoice } from '@/api/generated'
import { cn } from '@/lib/utils'
import { useWebSocket } from '@/hooks/useWebSocket'
import { toast } from 'sonner'

interface NarrativeInterfaceProps {
  characterId: string
}

export const NarrativeInterface: React.FC<NarrativeInterfaceProps> = ({
  characterId,
}) => {
  const { performAction, getAvailableActions, isLoading } =
    useNarrativeActions(characterId)
  const [narrativeHistory, setNarrativeHistory] = useState<string[]>([])
  const [currentActions, setCurrentActions] = useState<ActionChoice[]>([])
  const [selectedLocationInfo, setSelectedLocationInfo] = useState<any>(null)

  // WebSocket接続
  const { subscribe } = useWebSocket()

  useEffect(() => {
    // WebSocketイベントの購読
    const unsubscribe = subscribe('narrative:location_changed', (data: any) => {
      // 場所変更時のアニメーション通知
      toast.success(`${data.to.name}へ移動しました`, {
        icon: <MapPin className="h-4 w-4" />,
      })
    })

    return unsubscribe
  }, [subscribe])

  // 初期行動選択肢を取得
  useEffect(() => {
    loadActions()
  }, [characterId])

  const loadActions = async () => {
    const actions = await getAvailableActions()
    setCurrentActions(actions)
  }

  // 行動を実行
  const handleAction = async (action: ActionChoice) => {
    const response = await performAction({
      actionText: action.text,
      actionType: 'choice' as const,
    })

    if (response) {
      // 物語履歴に追加
      setNarrativeHistory(prev => [...prev, response.narrative])

      // 新しい行動選択肢を設定
      if (response.choices) {
        setCurrentActions(response.choices)
      }

      // メタデータからイベント処理
      if (
        response.metadata?.events &&
        Array.isArray(response.metadata.events)
      ) {
        response.metadata.events.forEach((event: any) => {
          toast(event.title, {
            description: event.description,
            icon: <Sparkles className="h-4 w-4" />,
          })
        })
      }
    }
  }

  // 場所情報の表示
  const handleLocationInfo = (location: any) => {
    setSelectedLocationInfo(location)
    toast.info(`${location.name}の情報`, {
      description: `危険度: ${location.danger_level} / 階層: 第${location.layer}層`,
    })
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 h-full">
      {/* メイン物語エリア */}
      <Card className="p-6 bg-gray-900 border-gray-800">
        <ScrollArea className="h-[500px] pr-4">
          <div className="space-y-4">
            {/* 物語履歴 */}
            {narrativeHistory.map((narrative, index) => (
              <div key={index} className="space-y-2">
                <p className="text-gray-100 leading-relaxed whitespace-pre-wrap">
                  {narrative}
                </p>
                {index < narrativeHistory.length - 1 && (
                  <Separator className="bg-gray-700" />
                )}
              </div>
            ))}

            {/* 現在の物語がない場合の初期メッセージ */}
            {narrativeHistory.length === 0 && (
              <div className="text-center py-12">
                <MapPin className="h-12 w-12 mx-auto mb-4 text-gray-600" />
                <p className="text-gray-400">物語が始まろうとしています...</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* 行動選択肢 */}
        <div className="mt-6 space-y-2">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">
            次の行動を選択
          </h3>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="grid gap-2">
              {currentActions.map((action, index) => (
                <Button
                  key={index}
                  variant="outline"
                  className={cn(
                    'justify-start text-left h-auto py-3 px-4',
                    'border-gray-700 hover:border-primary',
                    'hover:bg-gray-800 transition-colors'
                  )}
                  onClick={() => handleAction(action)}
                  disabled={isLoading}
                >
                  <div className="space-y-1">
                    <p className="font-medium">{action.text}</p>
                    {action.difficulty && (
                      <p className="text-xs text-gray-400">
                        難易度: {action.difficulty}
                      </p>
                    )}
                  </div>
                </Button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* サイドパネル：ミニマップ */}
      <div className="space-y-4">
        <Card className="p-4 bg-gray-900 border-gray-800">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">現在地</h3>
          <Minimap
            characterId={characterId}
            interactionMode="view-only"
            onLocationInfo={handleLocationInfo}
            className="relative position-static bottom-auto right-auto w-full h-[250px]"
          />
        </Card>

        {/* 場所情報 */}
        {selectedLocationInfo && (
          <Card className="p-4 bg-gray-900 border-gray-800">
            <h3 className="text-sm font-semibold text-gray-400 mb-2">
              {selectedLocationInfo.name}
            </h3>
            <div className="space-y-1 text-sm">
              <p className="text-gray-300">
                {selectedLocationInfo.description}
              </p>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">危険度</span>
                <span
                  className={cn(
                    'font-medium',
                    selectedLocationInfo.danger_level === 'safe' &&
                      'text-green-400',
                    selectedLocationInfo.danger_level === 'low' &&
                      'text-yellow-400',
                    selectedLocationInfo.danger_level === 'medium' &&
                      'text-orange-400',
                    selectedLocationInfo.danger_level === 'high' &&
                      'text-red-400',
                    selectedLocationInfo.danger_level === 'extreme' &&
                      'text-purple-400'
                  )}
                >
                  {selectedLocationInfo.danger_level}
                </span>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
