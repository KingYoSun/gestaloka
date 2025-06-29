import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, User, Shield, Sparkles, AlertTriangle, Skull, HelpCircle, X } from 'lucide-react'
import type { NPCEncounterData } from '@/types/websocket'

interface NPCEncounterDialogProps {
  encounter: NPCEncounterData | null
  onAction: (npcId: string, action: string) => void
  isLoading?: boolean
}

export function NPCEncounterDialog({ encounter, onAction, isLoading = false }: NPCEncounterDialogProps) {
  const [selectedAction, setSelectedAction] = useState<string | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  // 遭遇データが変わったら表示をリセット
  useEffect(() => {
    setSelectedAction(null)
    setIsVisible(!!encounter)
  }, [encounter])

  if (!encounter || !isVisible) return null

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
      case 'hostile': return <Skull className="h-4 w-4" />
      case 'friendly': return <User className="h-4 w-4" />
      case 'mysterious': return <HelpCircle className="h-4 w-4" />
      default: return <Sparkles className="h-4 w-4" />
    }
  }

  const getEncounterBadgeVariant = (type: string) => {
    switch (type) {
      case 'hostile': return 'destructive'
      case 'friendly': return 'default' 
      case 'mysterious': return 'secondary'
      default: return 'outline'
    }
  }

  const handleActionClick = (choiceId: string) => {
    setSelectedAction(choiceId)
    onAction(npc.npc_id, choiceId)
  }

  const handleClose = () => {
    setIsVisible(false)
  }

  return (
    <Card className="fixed bottom-4 right-4 w-96 max-h-[600px] shadow-xl z-50 border-2 border-primary/20 animate-in slide-in-from-bottom-5 duration-300">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="w-5 h-5" />
              {npc.name}
            </CardTitle>
            {npc.title && (
              <CardDescription className="text-sm font-medium mt-1">
                「{npc.title}」
              </CardDescription>
            )}
          </div>
          <div className="flex items-start gap-2">
            <div className="flex flex-col items-end gap-1">
              <Badge variant={getEncounterBadgeVariant(encounter.encounter_type)}>
                {getEncounterIcon(encounter.encounter_type)}
                <span className="ml-1">{encounter.encounter_type}</span>
              </Badge>
              <Badge className={`${getTypeColor(npc.npc_type)} text-white text-xs`}>
                {npc.npc_type.replace('_', ' ')}
              </Badge>
              {npc.contamination_level > 0 && (
                <div className={`flex items-center gap-1 text-xs ${getContaminationColor(npc.contamination_level)}`}>
                  <AlertTriangle className="w-3 h-3" />
                  <span>汚染度: {npc.contamination_level}</span>
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 -mr-2 -mt-2"
              onClick={handleClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
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
                {choices.map((choice) => (
                  <Button
                    key={choice.id}
                    variant={selectedAction === choice.id ? "default" : "outline"}
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
                      <span className="text-sm break-words flex-1">{choice.text}</span>
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
      </CardContent>
    </Card>
  )
}