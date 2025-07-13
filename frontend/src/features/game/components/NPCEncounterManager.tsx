import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Users, X } from 'lucide-react'
import { NPCEncounterDialog } from './NPCEncounterDialog'
import type { NPCEncounterData } from '../types'

interface NPCEncounterManagerProps {
  encounters: NPCEncounterData[]
  onAction: (npcId: string, action: string) => void
  isLoading?: boolean
}

export function NPCEncounterManager({
  encounters,
  onAction,
  isLoading = false,
}: NPCEncounterManagerProps) {
  const [activeNpcId, setActiveNpcId] = useState<string | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  // 遭遇データが変わったら表示をリセット
  useEffect(() => {
    if (encounters.length > 0) {
      setIsVisible(true)
      // 最初のNPCをアクティブにする
      if (!activeNpcId || !encounters.find(e => e.npc.npc_id === activeNpcId)) {
        setActiveNpcId(encounters[0].npc.npc_id)
      }
    } else {
      setIsVisible(false)
      setActiveNpcId(null)
    }
  }, [encounters, activeNpcId])

  if (!isVisible || encounters.length === 0) return null

  // 単一NPCの場合は既存のダイアログを使用
  if (encounters.length === 1) {
    return (
      <NPCEncounterDialog
        encounter={encounters[0]}
        onAction={onAction}
        isLoading={isLoading}
      />
    )
  }

  // 複数NPCの場合
  const activeEncounter = encounters.find(e => e.npc.npc_id === activeNpcId)

  const handleClose = () => {
    setIsVisible(false)
  }

  const handleAllAction = (action: string) => {
    // 全NPCに対して同じアクションを実行
    encounters.forEach(encounter => {
      onAction(encounter.npc.npc_id, action)
    })
  }

  return (
    <div className="fixed bottom-4 right-4 w-[480px] max-h-[700px] shadow-xl z-50 animate-in slide-in-from-bottom-5 duration-300">
      <div className="bg-background border-2 border-primary/20 rounded-lg overflow-hidden flex flex-col h-full">
        {/* ヘッダー */}
        <div className="p-4 border-b bg-muted/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              <h3 className="font-semibold">複数のNPCと遭遇中</h3>
              <Badge variant="default">{encounters.length}体</Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 -mr-2"
              onClick={handleClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* NPCタブ */}
        <Tabs
          value={activeNpcId || undefined}
          onValueChange={setActiveNpcId}
          className="flex-1 flex flex-col"
        >
          <TabsList className="w-full justify-start rounded-none border-b h-auto p-0">
            {encounters.map(encounter => (
              <TabsTrigger
                key={encounter.npc.npc_id}
                value={encounter.npc.npc_id}
                className="flex-1 rounded-none border-r last:border-r-0 data-[state=active]:shadow-none data-[state=active]:bg-background"
              >
                <div className="flex flex-col items-center gap-1 py-2">
                  <span className="text-sm font-medium">
                    {encounter.npc.name}
                  </span>
                  {encounter.npc.title && (
                    <span className="text-xs text-muted-foreground">
                      {encounter.npc.title}
                    </span>
                  )}
                </div>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* 各NPCの詳細 */}
          {encounters.map(encounter => (
            <TabsContent
              key={encounter.npc.npc_id}
              value={encounter.npc.npc_id}
              className="flex-1 m-0 overflow-auto"
            >
              {activeEncounter && (
                <NPCEncounterContent
                  encounter={encounter}
                  onAction={onAction}
                  isLoading={isLoading}
                />
              )}
            </TabsContent>
          ))}
        </Tabs>

        {/* 全体アクション */}
        <div className="p-4 border-t bg-muted/50">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleAllAction('talk_all')}
              disabled={isLoading}
              className="flex-1"
            >
              全員と話す
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleAllAction('help_all')}
              disabled={isLoading}
              className="flex-1"
            >
              全員に協力を申し出る
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleAllAction('ignore')}
              disabled={isLoading}
              className="flex-1"
            >
              全員を無視する
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// NPCEncounterDialogの内容部分を抽出したコンポーネント
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Loader2,
  User,
  Shield,
  Sparkles,
  AlertTriangle,
  Skull,
  HelpCircle,
} from 'lucide-react'

interface NPCEncounterContentProps {
  encounter: NPCEncounterData
  onAction: (npcId: string, action: string) => void
  isLoading?: boolean
}

function NPCEncounterContent({
  encounter,
  onAction,
  isLoading = false,
}: NPCEncounterContentProps) {
  const [selectedAction, setSelectedAction] = useState<string | null>(null)
  const { npc, choices = [] } = encounter

  // NPCタイプによるバッジ色の決定
  const getTypeColor = (type: string) => {
    switch (type) {
      case 'LOG_NPC':
        return 'bg-blue-500'
      case 'PERMANENT_NPC':
        return 'bg-purple-500'
      case 'TEMPORARY_NPC':
        return 'bg-gray-500'
      default:
        return 'bg-gray-400'
    }
  }

  // 汚染レベルによる警告色
  const getContaminationColor = (level: number) => {
    if (level >= 8) return 'text-red-600'
    if (level >= 5) return 'text-orange-500'
    if (level >= 3) return 'text-yellow-600'
    return 'text-gray-600'
  }

  // 難易度による色
  const getDifficultyColor = (difficulty?: string | null) => {
    switch (difficulty) {
      case 'hard':
        return 'text-red-600'
      case 'medium':
        return 'text-orange-500'
      case 'easy':
        return 'text-green-600'
      default:
        return 'text-gray-600'
    }
  }

  // 遭遇タイプのアイコンと色
  const getEncounterIcon = (type: string) => {
    switch (type) {
      case 'hostile':
        return <Skull className="h-4 w-4" />
      case 'friendly':
        return <User className="h-4 w-4" />
      case 'mysterious':
        return <HelpCircle className="h-4 w-4" />
      default:
        return <Sparkles className="h-4 w-4" />
    }
  }

  const getEncounterBadgeVariant = (type: string) => {
    switch (type) {
      case 'hostile':
        return 'destructive'
      case 'friendly':
        return 'default'
      case 'mysterious':
        return 'secondary'
      default:
        return 'outline'
    }
  }

  const handleActionClick = (choiceId: string) => {
    setSelectedAction(choiceId)
    onAction(npc.npc_id, choiceId)
  }

  return (
    <div className="p-4 space-y-4">
      {/* NPCの情報 */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <Badge
            variant={
              getEncounterBadgeVariant(encounter.encounter_type) as
                | 'default'
                | 'destructive'
                | 'secondary'
                | 'outline'
            }
          >
            {getEncounterIcon(encounter.encounter_type)}
            <span className="ml-1">{encounter.encounter_type}</span>
          </Badge>
          <Badge className={`${getTypeColor(npc.npc_type)} text-white text-xs`}>
            {npc.npc_type.replace('_', ' ')}
          </Badge>
          {npc.contamination_level > 0 && (
            <div
              className={`flex items-center gap-1 text-xs ${getContaminationColor(npc.contamination_level)}`}
            >
              <AlertTriangle className="w-3 h-3" />
              <span>汚染度: {npc.contamination_level}</span>
            </div>
          )}
        </div>
      </div>

      {/* NPCの特徴 */}
      <div className="space-y-2">
        {npc.appearance && (
          <p className="text-sm text-muted-foreground">{npc.appearance}</p>
        )}

        {npc.personality_traits.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {npc.personality_traits.map((trait, index) => (
              <Badge key={index} variant="outline" className="text-xs">
                {trait}
              </Badge>
            ))}
          </div>
        )}

        {npc.skills.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {npc.skills.map((skill, index) => (
              <Badge key={index} variant="secondary" className="text-xs">
                {skill}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* 選択肢 */}
      {choices.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">行動を選択してください:</p>
          <ScrollArea className="max-h-[250px]">
            <div className="space-y-2 pr-4">
              {choices.map(choice => (
                <Button
                  key={choice.id}
                  variant={selectedAction === choice.id ? 'default' : 'outline'}
                  className="w-full justify-start text-left h-auto py-3 px-4"
                  onClick={() => handleActionClick(choice.id)}
                  disabled={isLoading}
                >
                  <div className="flex items-start gap-2 w-full">
                    {choice.difficulty && (
                      <Badge
                        variant="outline"
                        className={`${getDifficultyColor(choice.difficulty)} border-current shrink-0`}
                      >
                        {choice.difficulty}
                      </Badge>
                    )}
                    <span className="text-sm break-words flex-1">
                      {choice.text}
                    </span>
                    {isLoading && selectedAction === choice.id && (
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    )}
                  </div>
                </Button>
              ))}
            </div>
          </ScrollArea>
        </div>
      ) : (
        /* デフォルトアクション（選択肢がない場合） */
        <div className="flex gap-2">
          <Button
            onClick={() => handleActionClick('interact')}
            disabled={isLoading}
            className="flex-1"
          >
            話しかける
          </Button>
          <Button
            onClick={() => handleActionClick('observe')}
            disabled={isLoading}
            variant="secondary"
            className="flex-1"
          >
            観察する
          </Button>
          <Button
            onClick={() => handleActionClick('leave')}
            disabled={isLoading}
            variant="outline"
            className="flex-1"
          >
            立ち去る
          </Button>
        </div>
      )}

      {/* ログソース情報 */}
      {npc.log_source && (
        <div className="text-xs text-muted-foreground border-t pt-2 flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          <span>ログ起源: {npc.original_player || '不明'}</span>
        </div>
      )}

      {/* 永続性レベル */}
      {npc.persistence_level > 0 && (
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Shield className="w-3 h-3" />
          <span>永続性: {npc.persistence_level}/10</span>
        </div>
      )}
    </div>
  )
}
