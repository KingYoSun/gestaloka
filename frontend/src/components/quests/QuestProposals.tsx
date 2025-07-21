import React from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sparkles, Target, BookOpen } from 'lucide-react'
import {
  useQuestProposals,
  useAcceptQuest,
  useCreateQuest,
} from '@/hooks/useQuests'
import { useActiveCharacter } from '@/hooks/useActiveCharacter'
import type { QuestProposal } from '@/types/quest'
import { QuestOrigin, QuestOriginDisplay } from '@/types/quest'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'

interface QuestProposalCardProps {
  proposal: QuestProposal
  onAccept: (proposal: QuestProposal) => void
  isAccepting: boolean
}

const QuestProposalCard: React.FC<QuestProposalCardProps> = ({
  proposal,
  onAccept,
  isAccepting,
}) => {
  const getOriginIcon = (origin: QuestOrigin) => {
    switch (origin) {
      case QuestOrigin.GM_PROPOSED:
        return <Sparkles className="h-4 w-4" />
      case QuestOrigin.BEHAVIOR_INFERRED:
        return <Target className="h-4 w-4" />
      default:
        return <BookOpen className="h-4 w-4" />
    }
  }

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">{proposal.title}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="flex items-center gap-1">
                {getOriginIcon(proposal.origin)}
                <span>{QuestOriginDisplay[proposal.origin]}</span>
              </Badge>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => onAccept(proposal)}
            disabled={isAccepting}
          >
            受諾する
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <CardDescription className="whitespace-pre-wrap mb-4">
          {proposal.description}
        </CardDescription>

        {proposal.rationale && (
          <div className="text-sm text-muted-foreground mb-3">
            <span className="font-medium">提案理由: </span>
            {proposal.rationale}
          </div>
        )}

        {proposal.key_themes && proposal.key_themes.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {proposal.key_themes.map((theme, index) => (
              <Badge key={index} variant="outline" className="text-xs">
                {theme}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export const QuestProposals: React.FC = () => {
  const { character } = useActiveCharacter()
  const { proposals, isLoading, error, refetch } = useQuestProposals(
    character?.id
  )
  const acceptQuest = useAcceptQuest(character?.id)
  const createQuest = useCreateQuest(character?.id)

  const handleAccept = async (proposal: QuestProposal) => {
    try {
      // まず新しいクエストを作成
      const newQuest = await createQuest.mutateAsync({
        title: proposal.title,
        description: proposal.description,
        origin: proposal.origin,
      })

      // 作成したクエストを受諾
      await acceptQuest.mutateAsync(newQuest.id!)
      toast.success(`「${proposal.title}」を受諾しました`)
    } catch {
      toast.error('クエストの受諾に失敗しました')
    }
  }

  if (!character) {
    return (
      <Alert>
        <AlertDescription>キャラクターを選択してください</AlertDescription>
      </Alert>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>クエスト提案の取得に失敗しました</AlertDescription>
      </Alert>
    )
  }

  if (proposals.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground mb-4">
            現在、新しいクエストの提案はありません
          </p>
          <Button variant="outline" onClick={() => refetch()}>
            再読み込み
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          クエスト提案
        </h3>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          更新
        </Button>
      </div>

      {proposals.map((proposal, index) => {
        // 自動生成された型に不足しているプロパティを追加
        const extendedProposal: QuestProposal = {
          ...proposal,
          origin: QuestOrigin.GM_PROPOSED,
          rationale: proposal.reasoning || '',
          key_themes: proposal.suggested_rewards || [],
        }
        
        return (
          <QuestProposalCard
            key={index}
            proposal={extendedProposal}
            onAccept={handleAccept}
            isAccepting={acceptQuest.isPending}
          />
        )
      })}
    </div>
  )
}
