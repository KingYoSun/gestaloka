/**
 * セッション終了提案ダイアログ
 */
import { AlertCircle, Trophy } from 'lucide-react'
import { SessionEndingProposal } from '@/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'

interface SessionEndingDialogProps {
  proposal: SessionEndingProposal
  isOpen: boolean
  onAccept: () => void
  onContinue: () => void
  isAccepting?: boolean
  isRejecting?: boolean
}

export function SessionEndingDialog({
  proposal,
  isOpen,
  onAccept,
  onContinue,
  isAccepting = false,
  isRejecting = false,
}: SessionEndingDialogProps) {
  const isLoading = isAccepting || isRejecting

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">物語の区切り</DialogTitle>
          <DialogDescription>
            GM AIが物語の良い区切りと判断しました
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 終了理由 */}
          <div className="bg-muted p-4 rounded-lg">
            <p className="text-sm">{proposal.reason}</p>
          </div>

          {/* ストーリーサマリープレビュー */}
          <div>
            <h4 className="font-semibold mb-2">これまでのあらすじ</h4>
            <p className="text-sm text-muted-foreground">
              {proposal.summaryPreview}
            </p>
          </div>

          <Separator />

          {/* 報酬プレビュー */}
          <div>
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <Trophy className="h-4 w-4" />
              獲得予定の報酬
            </h4>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm">経験値:</span>
                <Badge variant="secondary">
                  +{proposal.rewardsPreview.experience} EXP
                </Badge>
              </div>

              {Object.keys(proposal.rewardsPreview.skills).length > 0 && (
                <div>
                  <span className="text-sm">スキル向上:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Object.entries(proposal.rewardsPreview.skills).map(
                      ([skill, value]) => (
                        <Badge
                          key={skill}
                          variant="outline"
                          className="text-xs"
                        >
                          {skill} +{value}
                        </Badge>
                      )
                    )}
                  </div>
                </div>
              )}

              {proposal.rewardsPreview.items.length > 0 && (
                <div>
                  <span className="text-sm">アイテム:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {proposal.rewardsPreview.items.map((item, index) => (
                      <Badge
                        key={index}
                        variant="secondary"
                        className="text-xs"
                      >
                        {item}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* 次回への引き */}
          <div>
            <h4 className="font-semibold mb-2">次回への引き</h4>
            <p className="text-sm text-muted-foreground italic">
              「{proposal.continuationHint}」
            </p>
          </div>

          {/* 強制終了の警告 */}
          {proposal.isMandatory && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                物語が長くなってきたため、今回は必ずここで区切りとなります。
                次回、続きから再開できます。
              </AlertDescription>
            </Alert>
          )}

          {/* 提案回数の表示 */}
          {!proposal.isMandatory && proposal.proposalCount > 1 && (
            <p className="text-xs text-muted-foreground text-center">
              終了提案 {proposal.proposalCount}/3回目
              {proposal.proposalCount === 2 && ' (次回は強制終了となります)'}
            </p>
          )}
        </div>

        <DialogFooter className="flex gap-2">
          {!proposal.isMandatory && (
            <Button variant="outline" onClick={onContinue} disabled={isLoading}>
              {isRejecting ? '処理中...' : 'もう少し続ける'}
            </Button>
          )}
          <Button
            onClick={onAccept}
            disabled={isLoading}
            className="min-w-[120px]"
          >
            {isAccepting ? '処理中...' : 'ここで終了する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
