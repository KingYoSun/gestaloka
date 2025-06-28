import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { User, Sparkles, Skull, HelpCircle } from 'lucide-react'
import type { NPCEncounterData } from '@/types/websocket'

interface NPCEncounterDialogProps {
  encounter: NPCEncounterData | null
  onAction: (npcId: string, action: string) => void
  isLoading?: boolean
}

export function NPCEncounterDialog({ encounter, onAction, isLoading = false }: NPCEncounterDialogProps) {
  if (!encounter) return null

  const getEncounterBadgeVariant = (type: string) => {
    switch (type) {
      case 'hostile': return 'destructive'
      case 'friendly': return 'default'
      case 'mysterious': return 'secondary'
      default: return 'outline'
    }
  }

  const getEncounterIcon = (type: string) => {
    switch (type) {
      case 'hostile': return <Skull className="h-4 w-4" />
      case 'friendly': return <User className="h-4 w-4" />
      case 'mysterious': return <HelpCircle className="h-4 w-4" />
      default: return <Sparkles className="h-4 w-4" />
    }
  }

  const getNPCTypeLabel = (type: string) => {
    switch (type) {
      case 'LOG_NPC': return 'ログNPC'
      case 'PERMANENT_NPC': return '永続NPC'
      case 'TEMPORARY_NPC': return '一時NPC'
      default: return 'NPC'
    }
  }

  const getDifficultyColor = (difficulty?: string | null) => {
    switch (difficulty) {
      case 'easy': return 'text-green-600'
      case 'medium': return 'text-yellow-600'
      case 'hard': return 'text-red-600'
      default: return ''
    }
  }

  return (
    <Dialog open={!!encounter}>
      <DialogContent className="max-w-2xl" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="text-xl font-bold">
              {encounter.npc.name}
              {encounter.npc.title && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  「{encounter.npc.title}」
                </span>
              )}
            </DialogTitle>
            <div className="flex gap-2">
              <Badge variant={getEncounterBadgeVariant(encounter.encounter_type)}>
                {getEncounterIcon(encounter.encounter_type)}
                <span className="ml-1">{encounter.encounter_type}</span>
              </Badge>
              <Badge variant="outline">
                {getNPCTypeLabel(encounter.npc.npc_type)}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* NPC外見 */}
          {encounter.npc.appearance && (
            <div className="bg-secondary/30 rounded-lg p-3">
              <p className="text-sm">{encounter.npc.appearance}</p>
            </div>
          )}

          {/* NPCの性格と行動パターン */}
          <div className="grid grid-cols-2 gap-4">
            {encounter.npc.personality_traits.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-1 text-muted-foreground">性格特性</p>
                <div className="flex flex-wrap gap-1">
                  {encounter.npc.personality_traits.map((trait, index) => (
                    <Badge key={index} variant="secondary" className="text-xs">
                      {trait}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {encounter.npc.behavior_patterns.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-1 text-muted-foreground">行動パターン</p>
                <div className="flex flex-wrap gap-1">
                  {encounter.npc.behavior_patterns.map((pattern, index) => (
                    <Badge key={index} variant="secondary" className="text-xs">
                      {pattern}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* NPCのスキル */}
          {encounter.npc.skills.length > 0 && (
            <div>
              <p className="text-sm font-semibold mb-1 text-muted-foreground">スキル</p>
              <div className="flex flex-wrap gap-1">
                {encounter.npc.skills.map((skill, index) => (
                  <Badge key={index} variant="outline" className="text-xs">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* 汚染レベル */}
          {encounter.npc.npc_type === 'LOG_NPC' && (
            <div className="bg-destructive/10 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">汚染レベル</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 bg-secondary rounded-full h-2">
                    <div 
                      className="bg-destructive h-2 rounded-full transition-all"
                      style={{ width: `${encounter.npc.contamination_level}%` }}
                    />
                  </div>
                  <span className="text-sm font-mono">{encounter.npc.contamination_level}%</span>
                </div>
              </div>
            </div>
          )}

          {/* 選択肢 */}
          {encounter.choices && encounter.choices.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="text-sm font-semibold text-muted-foreground">どうしますか？</p>
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-2">
                  {encounter.choices.map((choice) => (
                    <Button
                      key={choice.id}
                      onClick={() => onAction(encounter.npc.npc_id, choice.id)}
                      variant="outline"
                      className="w-full justify-start text-left"
                      disabled={isLoading}
                    >
                      <span className="flex-1">{choice.text}</span>
                      {choice.difficulty && (
                        <span className={`text-xs ml-2 ${getDifficultyColor(choice.difficulty)}`}>
                          [{choice.difficulty}]
                        </span>
                      )}
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* デフォルトアクション（選択肢がない場合） */}
          {(!encounter.choices || encounter.choices.length === 0) && (
            <div className="flex gap-2 pt-2">
              <Button
                onClick={() => onAction(encounter.npc.npc_id, 'interact')}
                disabled={isLoading}
                className="flex-1"
              >
                話しかける
              </Button>
              <Button
                onClick={() => onAction(encounter.npc.npc_id, 'observe')}
                disabled={isLoading}
                variant="secondary"
                className="flex-1"
              >
                観察する
              </Button>
              <Button
                onClick={() => onAction(encounter.npc.npc_id, 'leave')}
                disabled={isLoading}
                variant="outline"
                className="flex-1"
              >
                立ち去る
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}