import { useState } from 'react'
import { CompletedLog, PurificationItem, PurificationItemType } from '@/types/log'
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
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Shield,
  Sparkles,
  AlertTriangle,
  Info,
  Droplet,
  Gem,
  Book,
  Feather,
  Leaf,
  ArrowRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { logsApi } from '@/api/logs'
import { useToast } from '@/hooks/use-toast'
import { useQueryClient } from '@tanstack/react-query'

interface PurificationDialogProps {
  log: CompletedLog
  purificationItems: PurificationItem[]
  onPurify: () => void
  onClose: () => void
}

// 浄化アイテムのアイコン
const PURIFICATION_ITEM_ICONS: Record<PurificationItemType, React.ElementType> = {
  HOLY_WATER: Droplet,
  LIGHT_CRYSTAL: Gem,
  PURIFICATION_TOME: Book,
  ANGEL_TEARS: Feather,
  WORLD_TREE_LEAF: Leaf,
}

// 浄化アイテムの表示名
const PURIFICATION_ITEM_LABELS: Record<PurificationItemType, string> = {
  HOLY_WATER: '聖水',
  LIGHT_CRYSTAL: '光のクリスタル',
  PURIFICATION_TOME: '浄化の書',
  ANGEL_TEARS: '天使の涙',
  WORLD_TREE_LEAF: '世界樹の葉',
}

// 浄化アイテムの説明
const PURIFICATION_ITEM_DESCRIPTIONS: Record<PurificationItemType, string> = {
  HOLY_WATER: '基本的な浄化アイテム。軽度の汚染を取り除きます。',
  LIGHT_CRYSTAL: '光の力を宿したクリスタル。中程度の汚染を浄化します。',
  PURIFICATION_TOME: '古代の知識が記された書物。強力な浄化効果があります。',
  ANGEL_TEARS: '天使の涙から生まれた聖なるアイテム。高度な浄化が可能です。',
  WORLD_TREE_LEAF: '世界樹の葉。最も強力な浄化効果を持ちます。',
}

export function PurificationDialog({
  log,
  purificationItems,
  onPurify,
  onClose,
}: PurificationDialogProps) {
  const [selectedItemId, setSelectedItemId] = useState<string>('')
  const [isPurifying, setIsPurifying] = useState(false)
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const selectedItem = purificationItems.find(item => item.id === selectedItemId)

  // 浄化後の汚染度を計算
  const calculatePurifiedLevel = () => {
    if (!selectedItem) return log.contaminationLevel
    const purificationAmount = selectedItem.purification_power / 100
    return Math.max(0, log.contaminationLevel - purificationAmount)
  }

  const purifiedLevel = calculatePurifiedLevel()

  const handlePurify = async () => {
    if (!selectedItemId) return

    setIsPurifying(true)
    try {
      const response = await logsApi.purifyLog(log.id, {
        purification_item_id: selectedItemId,
      })

      toast({
        title: '浄化完了',
        description: `汚染度が${Math.round(response.old_contamination * 100)}%から${Math.round(response.new_contamination * 100)}%に減少しました。`,
        variant: 'success',
      })

      // 特殊効果がある場合は表示
      if (response.special_effects.length > 0) {
        toast({
          title: '特殊効果発動！',
          description: response.special_effects.join(' '),
          variant: 'default',
        })
      }

      // 特殊称号を獲得した場合は表示
      if (response.special_title) {
        toast({
          title: '特殊称号獲得！',
          description: `「${response.special_title}」を獲得しました！`,
          variant: 'success',
        })
      }

      // データを更新
      queryClient.invalidateQueries({ queryKey: ['completedLogs'] })
      queryClient.invalidateQueries({ queryKey: ['purificationItems'] })

      onPurify()
    } catch (error) {
      console.error('Purification failed:', error)
      toast({
        title: 'エラー',
        description: '浄化に失敗しました。',
        variant: 'destructive',
      })
    } finally {
      setIsPurifying(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            ログの浄化
          </DialogTitle>
          <DialogDescription>
            浄化アイテムを使用して、ログの汚染を取り除きます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* 現在の汚染度 */}
          <div>
            <h4 className="text-sm font-semibold mb-2">現在の汚染度</h4>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Progress
                  value={log.contaminationLevel * 100}
                  className={cn(
                    'h-3',
                    log.contaminationLevel > 0.7 && '[&>div]:bg-red-500',
                    log.contaminationLevel > 0.5 && log.contaminationLevel <= 0.7 && '[&>div]:bg-yellow-500',
                    log.contaminationLevel <= 0.5 && '[&>div]:bg-green-500'
                  )}
                />
                <p className="text-sm text-muted-foreground mt-1">
                  {Math.round(log.contaminationLevel * 100)}%
                </p>
              </div>
              {selectedItem && (
                <>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <Progress
                      value={purifiedLevel * 100}
                      className={cn(
                        'h-3',
                        purifiedLevel > 0.7 && '[&>div]:bg-red-500',
                        purifiedLevel > 0.5 && purifiedLevel <= 0.7 && '[&>div]:bg-yellow-500',
                        purifiedLevel <= 0.5 && '[&>div]:bg-green-500'
                      )}
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      {Math.round(purifiedLevel * 100)}% (浄化後)
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 浄化アイテム選択 */}
          <div>
            <h4 className="text-sm font-semibold mb-2">浄化アイテムを選択</h4>
            {purificationItems.length === 0 ? (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  浄化アイテムを持っていません。ポジティブなログフラグメントから作成できます。
                </AlertDescription>
              </Alert>
            ) : (
              <RadioGroup value={selectedItemId} onValueChange={setSelectedItemId}>
                <div className="space-y-3">
                  {purificationItems.map(item => {
                    const Icon = PURIFICATION_ITEM_ICONS[item.item_type]
                    return (
                      <Label
                        key={item.id}
                        htmlFor={item.id}
                        className={cn(
                          'flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-all',
                          selectedItemId === item.id
                            ? 'border-primary bg-primary/5'
                            : 'border-muted hover:bg-muted/50'
                        )}
                      >
                        <RadioGroupItem value={item.id} id={item.id} />
                        <Icon className="h-5 w-5 mt-0.5" />
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {PURIFICATION_ITEM_LABELS[item.item_type]}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              浄化力 {item.purification_power}%
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {PURIFICATION_ITEM_DESCRIPTIONS[item.item_type]}
                          </p>
                        </div>
                      </Label>
                    )
                  })}
                </div>
              </RadioGroup>
            )}
          </div>

          {/* 浄化効果の説明 */}
          {selectedItem && purifiedLevel < log.contaminationLevel && (
            <Alert>
              <Sparkles className="h-4 w-4" />
              <AlertDescription>
                <p className="font-semibold mb-1">浄化効果:</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>汚染度が{Math.round((log.contaminationLevel - purifiedLevel) * 100)}%減少します</li>
                  {purifiedLevel === 0 && (
                    <li className="text-green-600">完全浄化ボーナス: ログの力が50%強化されます</li>
                  )}
                  {purifiedLevel <= 0.2 && log.contaminationLevel > 0.8 && (
                    <li className="text-purple-600">汚染反転ボーナス: 「闇から光へ」の特殊称号を獲得</li>
                  )}
                  {purifiedLevel <= 0.3 && (
                    <li>新たな特性: 「清らか」「純粋」が付与されます</li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* 警告 */}
          {log.contaminationLevel > 0.7 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                このログは高度に汚染されています。浄化には強力なアイテムが必要です。
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPurifying}>
            キャンセル
          </Button>
          <Button
            onClick={handlePurify}
            disabled={!selectedItemId || isPurifying}
            className="gap-2"
          >
            <Shield className="h-4 w-4" />
            {isPurifying ? '浄化中...' : '浄化する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}