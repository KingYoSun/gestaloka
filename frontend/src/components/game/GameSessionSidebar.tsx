import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TextareaWithCounter } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Send,
  PenTool,
  Coins,
  AlertCircle,
} from 'lucide-react'
import { BattleStatus, type BattleData } from '@/features/game/components/BattleStatus'
import { QuestStatusWidget } from '@/components/quests/QuestStatusWidget'
import type { GameSession, ActionChoice } from '@/types'

interface GameSessionSidebarProps {
  session: GameSession
  currentChoices: ActionChoice[] | null
  isExecutingAction: boolean
  consumeSPPending: boolean
  battleData?: BattleData
  actionText: string
  selectedChoice: number | null
  onActionTextChange: (text: string) => void
  onChoiceSelect: (index: number) => void
  onSubmitAction: () => void
  calculateSPCost: (text: string, isChoice: boolean) => number
}

export function GameSessionSidebar({
  session,
  currentChoices,
  isExecutingAction,
  consumeSPPending,
  battleData,
  actionText,
  selectedChoice,
  onActionTextChange,
  onChoiceSelect,
  onSubmitAction,
  calculateSPCost,
}: GameSessionSidebarProps) {
  const handleChoiceSelect = (index: number) => {
    onChoiceSelect(index)
  }

  return (
    <div className="space-y-4 h-full overflow-y-auto pr-2">
      {/* クエスト状態 */}
      <QuestStatusWidget compact />

      {/* 戦闘状態 */}
      {battleData && (
        <BattleStatus battleData={battleData} />
      )}

      {/* 選択肢 */}
      {currentChoices && currentChoices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">選択肢</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {currentChoices.map((choice, index) => (
              <Button
                key={choice.id || index}
                variant={selectedChoice === index ? 'default' : 'outline'}
                className="w-full text-left justify-start h-auto p-3"
                onClick={() => handleChoiceSelect(index)}
              >
                <div className="flex-1">
                  <span className="whitespace-normal">{choice.text}</span>
                  {choice.difficulty && (
                    <div className="text-xs text-muted-foreground mt-1">
                      難易度: {choice.difficulty}
                    </div>
                  )}
                </div>
                <Badge variant="secondary" className="ml-2 shrink-0">
                  <Coins className="h-3 w-3 mr-1" />2 SP
                </Badge>
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 行動入力 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <PenTool className="h-5 w-5" />
            行動入力
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TextareaWithCounter
            placeholder="あなたの行動を入力してください..."
            value={actionText}
            onChange={e => onActionTextChange(e.target.value)}
            className="min-h-[100px]"
            disabled={!session.isActive || isExecutingAction}
            maxLength={500}
          />
          {actionText.trim() && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {selectedChoice !== null ? (
                  <>
                    選択肢の実行には <strong>2 SP</strong> が必要です
                  </>
                ) : (
                  <>
                    自由行動には{' '}
                    <strong>
                      {calculateSPCost(actionText.trim(), false)} SP
                    </strong>{' '}
                    が必要です
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}
          <Button
            onClick={onSubmitAction}
            disabled={
              !session.isActive || isExecutingAction || !actionText.trim() || consumeSPPending
            }
            className="w-full"
          >
            {isExecutingAction || consumeSPPending ? (
              <>
                <LoadingSpinner size="sm" className="mr-2" />
                実行中...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                {selectedChoice !== null
                  ? '選択肢を実行 (2 SP)'
                  : actionText.trim()
                    ? `行動実行 (${calculateSPCost(actionText.trim(), false)} SP)`
                    : '行動実行'}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* キャラクター情報 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">キャラクター情報</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div>
              <span className="font-medium">名前:</span>{' '}
              {session.characterName}
            </div>
            <div>
              <span className="font-medium">セッション開始:</span>
              <br />
              {new Date(session.createdAt).toLocaleString()}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}