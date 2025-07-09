/**
 * ゲームセッションページ
 */
import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  useGameSession,
  useExecuteGameAction,
  useEndGameSession,
  useSessionEndingProposal,
  useAcceptSessionEnding,
  useRejectSessionEnding,
} from '@/hooks/useGameSessions'
import { useGameSessionStore } from '@/stores/gameSessionStore'
import { useGameWebSocket } from '@/hooks/useWebSocket'
import { websocketManager } from '@/lib/websocket/socket'
import { useAuth } from '@/features/auth/useAuth'
import { SPTransactionType } from '@/types/sp'
import { useConsumeSP } from '@/hooks/useSP'
import { SessionEndingDialog } from '@/components/SessionEndingDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TextareaWithCounter } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import {
  Send,
  Home,
  StopCircle,
  User,
  Bot,
  AlertCircle,
  MessageSquare,
  Coins,
  Sparkles,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { toast } from 'sonner'
import {
  BattleStatus,
  type BattleData,
} from '@/features/game/components/BattleStatus'
import { NPCEncounterManager } from '@/features/game/components/NPCEncounterManager'
import { QuestStatusWidget } from '@/components/quests/QuestStatusWidget'

export const Route = createFileRoute('/_authenticated/game/$sessionId')({
  component: GameSessionPage,
})

function GameSessionPage() {
  const { sessionId } = Route.useParams()
  const { user } = useAuth()
  const [actionText, setActionText] = useState('')
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null)
  const [showEndingDialog, setShowEndingDialog] = useState(false)

  const { data: session, isLoading } = useGameSession(sessionId)
  const executeActionMutation = useExecuteGameAction()
  const endSessionMutation = useEndGameSession()
  const { data: endingProposal } = useSessionEndingProposal(sessionId)
  const acceptEndingMutation = useAcceptSessionEnding()
  const rejectEndingMutation = useRejectSessionEnding()
  const consumeSPMutation = useConsumeSP()

  const {
    setActiveSession,
    getSessionMessages,
    currentChoices,
    isExecutingAction,
    setExecutingAction,
  } = useGameSessionStore()

  // WebSocket接続
  const { sendAction, currentNPCEncounters, sendNPCAction } =
    useGameWebSocket(sessionId)
  // const { chatMessages, sendChatMessage } = useChatWebSocket(sessionId)

  const messages = getSessionMessages(sessionId)

  // セッションがロードされたらストアに設定
  useEffect(() => {
    if (session) {
      setActiveSession(session)
    }
  }, [session, setActiveSession])

  // 終了提案がある場合はダイアログを表示
  useEffect(() => {
    if (endingProposal && session?.isActive) {
      setShowEndingDialog(true)
    }
  }, [endingProposal, session?.isActive])

  const handleChoiceSelect = (choiceIndex: number) => {
    setSelectedChoice(choiceIndex)
    if (currentChoices && currentChoices[choiceIndex]) {
      setActionText(currentChoices[choiceIndex].text)
    }
  }

  // SP消費量を計算
  const calculateSPCost = (text: string, isChoice: boolean) => {
    if (isChoice) return 2 // 選択肢は一律2SP

    // 自由行動のSP消費量を文字数や複雑さで決定（簡易版）
    const length = text.length
    if (length <= 20) return 1
    if (length <= 50) return 2
    if (length <= 100) return 3
    return 5
  }

  const handleSubmitAction = async () => {
    if (!actionText.trim()) {
      toast.error('行動を入力してください')
      return
    }

    const isChoice = selectedChoice !== null
    const spCost = calculateSPCost(actionText.trim(), isChoice)

    // SP消費処理を実行
    try {
      await consumeSPMutation.mutateAsync({
        amount: spCost,
        transactionType: SPTransactionType.FREE_ACTION,
        description: `自由行動: ${actionText.trim().substring(0, 50)}${actionText.trim().length > 50 ? '...' : ''}`,
        relatedEntityType: 'game_session',
        relatedEntityId: sessionId,
        metadata: {
          actionText: actionText.trim(),
          sessionId,
          characterId: session?.characterId,
        },
      })

      // SP消費成功したらアクションを実行
      await executeAction(actionText.trim(), isChoice, selectedChoice ?? undefined)
    } catch (error: any) {
      console.error('Failed to consume SP:', error)
      // SP不足エラーはuseConsumeSPフックのonErrorで処理されるため、ここでは何もしない
    }
  }

  const executeAction = async (
    text: string,
    isChoice: boolean,
    choiceIndex?: number
  ) => {
    setExecutingAction(true)

    try {
      // WebSocket経由でアクションを送信
      sendAction(text)

      // 従来のAPI呼び出しも並行して実行（フォールバック）
      await executeActionMutation.mutateAsync({
        sessionId,
        action: {
          actionText: text,
          actionType: isChoice ? 'choice' : 'custom',
          choiceIndex: choiceIndex,
        },
      })

      setActionText('')
      setSelectedChoice(null)
    } catch (error: any) {
      console.error('Failed to execute action:', error)
      toast.error('行動の実行に失敗しました', {
        description:
          error?.response?.data?.detail || 'もう一度お試しください。',
      })
    } finally {
      setExecutingAction(false)
    }
  }


  const handleEndSession = async () => {
    if (!confirm('本当にセッションを終了しますか？')) {
      return
    }

    try {
      // WebSocketセッションから明示的に退出
      if (user?.id) {
        websocketManager.leaveGame(sessionId, user.id)
      }
      
      await endSessionMutation.mutateAsync(sessionId)
      toast.success('セッションを終了しました')
      // ホームページに戻る
      window.location.href = '/dashboard'
    } catch (error) {
      console.error('Failed to end session:', error)
      toast.error('セッションの終了に失敗しました')
    }
  }

  const handleAcceptEnding = async () => {
    try {
      await acceptEndingMutation.mutateAsync(sessionId)
      toast.success('セッションを終了しています...', {
        description:
          'リザルトを処理中です。完了後、自動的に画面が切り替わります。',
      })

      // リザルト画面へ遷移
      setTimeout(() => {
        window.location.href = `/game/${sessionId}/result`
      }, 2000)
    } catch (error) {
      console.error('Failed to accept ending:', error)
      toast.error('終了処理に失敗しました')
    }
  }

  const handleRejectEnding = async () => {
    try {
      const response = await rejectEndingMutation.mutateAsync(sessionId)
      setShowEndingDialog(false)

      if (!response.canRejectNext) {
        toast.warning('次回の終了提案は拒否できません', {
          description: '物語が長くなってきたため、次回は必ず終了となります。',
        })
      } else {
        toast.info('冒険を続けます')
      }
    } catch (error) {
      console.error('Failed to reject ending:', error)
      toast.error('処理に失敗しました')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>セッションが見つかりません。</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-4 h-screen flex flex-col">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">{session.characterName}の冒険</h1>
          <Badge variant={session.isActive ? 'default' : 'secondary'}>
            {session.isActive ? 'アクティブ' : '終了済み'}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => (window.location.href = '/memory')}
          >
            <Sparkles className="h-4 w-4 mr-2" />
            記憶継承
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => (window.location.href = '/dashboard')}
          >
            <Home className="h-4 w-4 mr-2" />
            ホーム
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleEndSession}
            disabled={!session.isActive || endSessionMutation.isPending}
          >
            <StopCircle className="h-4 w-4 mr-2" />
            終了
          </Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 min-h-0">
        {/* ゲーム画面 */}
        <div className="lg:col-span-3 flex flex-col">
          {/* 現在のシーン */}
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                現在のシーン
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-foreground whitespace-pre-wrap">
                {session.currentScene || '物語が始まろうとしています...'}
              </p>
            </CardContent>
          </Card>

          {/* メッセージ履歴 */}
          <Card className="flex-1 flex flex-col">
            <CardHeader>
              <CardTitle>会話履歴</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0">
              <ScrollArea className="h-full px-6 pb-6">
                <div className="space-y-4">
                  {messages.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      まだメッセージがありません。行動を入力して冒険を始めましょう！
                    </p>
                  ) : (
                    messages.map(message => (
                      <div
                        key={message.id}
                        className={`flex gap-3 ${
                          message.type === 'user' ? 'flex-row-reverse' : ''
                        }`}
                      >
                        <div
                          className={`flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-md border ${
                            message.type === 'user'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted'
                          }`}
                        >
                          {message.type === 'user' ? (
                            <User className="h-4 w-4" />
                          ) : (
                            <Bot className="h-4 w-4" />
                          )}
                        </div>
                        <div
                          className={`flex flex-col space-y-2 text-sm max-w-[80%] ${
                            message.type === 'user' ? 'items-end' : ''
                          }`}
                        >
                          <div
                            className={`rounded-lg px-3 py-2 ${
                              message.type === 'user'
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted'
                            }`}
                          >
                            {message.content}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(message.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* サイドバー */}
        <div className="space-y-4">
          {/* クエスト状態 */}
          <QuestStatusWidget compact />

          {/* 戦闘状態 */}
          {session.sessionData?.battle_data && (
            <BattleStatus
              battleData={
                session.sessionData.battle_data as unknown as BattleData
              }
            />
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
              <CardTitle className="text-lg">行動入力</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <TextareaWithCounter
                placeholder="あなたの行動を入力してください..."
                value={actionText}
                onChange={e => setActionText(e.target.value)}
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
                onClick={handleSubmitAction}
                disabled={
                  !session.isActive || isExecutingAction || !actionText.trim() || consumeSPMutation.isPending
                }
                className="w-full"
              >
                {isExecutingAction || consumeSPMutation.isPending ? (
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
      </div>


      {/* NPC遭遇マネージャー */}
      <NPCEncounterManager
        encounters={currentNPCEncounters}
        onAction={sendNPCAction}
        isLoading={isExecutingAction}
      />

      {/* セッション終了提案ダイアログ */}
      {endingProposal && (
        <SessionEndingDialog
          proposal={endingProposal}
          isOpen={showEndingDialog}
          onAccept={handleAcceptEnding}
          onContinue={handleRejectEnding}
          isAccepting={acceptEndingMutation.isPending}
          isRejecting={rejectEndingMutation.isPending}
        />
      )}
    </div>
  )
}
