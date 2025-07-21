import { useState } from 'react'
import { LogFragment } from '@/types/log'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Sparkles, Info, Heart, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCreatePurificationItem } from '../hooks/usePurificationItems'
import { useToast } from '@/hooks/useToast'

interface CreatePurificationItemDialogProps {
  fragments: LogFragment[]
  onClose: () => void
}

// レアリティに基づく浄化アイテムの種類
const RARITY_TO_ITEM_TYPE = {
  common: 'HOLY_WATER',
  uncommon: 'HOLY_WATER',
  rare: 'LIGHT_CRYSTAL',
  epic: 'PURIFICATION_TOME',
  legendary: 'ANGEL_TEARS',
  unique: 'WORLD_TREE_LEAF',
  architect: 'WORLD_TREE_LEAF',
}

// 浄化アイテムの説明
const ITEM_TYPE_INFO = {
  HOLY_WATER: { name: '聖水', power: 10, description: '基本的な浄化アイテム' },
  LIGHT_CRYSTAL: {
    name: '光のクリスタル',
    power: 20,
    description: '中程度の浄化力',
  },
  PURIFICATION_TOME: {
    name: '浄化の書',
    power: 30,
    description: '強力な浄化効果',
  },
  ANGEL_TEARS: { name: '天使の涙', power: 50, description: '高度な浄化が可能' },
  WORLD_TREE_LEAF: {
    name: '世界樹の葉',
    power: 70,
    description: '最強の浄化力',
  },
}

export function CreatePurificationItemDialog({
  fragments,
  onClose,
}: CreatePurificationItemDialogProps) {
  const [selectedFragmentId, setSelectedFragmentId] = useState<string>('')
  const { mutate: createItem, isPending } = useCreatePurificationItem()
  const { toast } = useToast()

  // ポジティブなフラグメントのみフィルタリング
  const positiveFragments = fragments.filter(
    f => f.emotionalValence === 'positive'
  )

  const selectedFragment = positiveFragments.find(
    f => f.id === selectedFragmentId
  )
  const expectedItemType = selectedFragment
    ? RARITY_TO_ITEM_TYPE[
        selectedFragment.rarity as keyof typeof RARITY_TO_ITEM_TYPE
      ]
    : null
  const expectedItemInfo = expectedItemType
    ? ITEM_TYPE_INFO[expectedItemType as keyof typeof ITEM_TYPE_INFO]
    : null

  const handleCreate = () => {
    if (!selectedFragmentId) return

    createItem(
      { fragment_id: selectedFragmentId } as any,
      {
        onSuccess: (response: any) => {
          const itemInfo =
            ITEM_TYPE_INFO[
              response.item_type as keyof typeof ITEM_TYPE_INFO
            ]
          toast({
            title: '浄化アイテム作成完了',
            description: `${itemInfo?.name || '浄化アイテム'}を作成しました。`,
            variant: 'success',
          })
          onClose()
        },
        onError: error => {
          console.error('Failed to create purification item:', error)
          toast({
            title: 'エラー',
            description: '浄化アイテムの作成に失敗しました。',
            variant: 'destructive',
          })
        },
      }
    )
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            浄化アイテムの作成
          </DialogTitle>
          <DialogDescription>
            ポジティブなログフラグメントを消費して、浄化アイテムを作成します。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* フラグメント選択 */}
          <div>
            <h4 className="text-sm font-semibold mb-2">フラグメントを選択</h4>
            {positiveFragments.length === 0 ? (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  ポジティブなログフラグメントがありません。ポジティブな行動を取ることで獲得できます。
                </AlertDescription>
              </Alert>
            ) : (
              <RadioGroup
                value={selectedFragmentId}
                onValueChange={setSelectedFragmentId}
              >
                <div className="space-y-3">
                  {positiveFragments.map(fragment => (
                    <Label
                      key={fragment.id}
                      htmlFor={fragment.id}
                      className={cn(
                        'flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-all',
                        selectedFragmentId === fragment.id
                          ? 'border-primary bg-primary/5'
                          : 'border-muted hover:bg-muted/50'
                      )}
                    >
                      <RadioGroupItem value={fragment.id} id={fragment.id} />
                      <Heart className="h-5 w-5 mt-0.5 text-green-600" />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{fragment.rarity}</Badge>
                          <Badge variant="outline" className="text-green-600">
                            ポジティブ
                          </Badge>
                          {fragment.importanceScore >= 0.8 && (
                            <Star className="h-4 w-4 text-yellow-500" />
                          )}
                        </div>
                        <p className="text-sm">{fragment.actionDescription}</p>
                        <div className="flex gap-1 mt-2">
                          {fragment.keywords.slice(0, 3).map((keyword, i) => (
                            <Badge
                              key={i}
                              variant="outline"
                              className="text-xs"
                            >
                              {keyword}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </Label>
                  ))}
                </div>
              </RadioGroup>
            )}
          </div>

          {/* 作成予定のアイテム情報 */}
          {selectedFragment && expectedItemInfo && (
            <Alert>
              <Sparkles className="h-4 w-4" />
              <AlertDescription>
                <p className="font-semibold mb-1">作成されるアイテム:</p>
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="font-medium">{expectedItemInfo.name}</span>{' '}
                    - 浄化力 {expectedItemInfo.power}%
                  </p>
                  <p className="text-muted-foreground">
                    {expectedItemInfo.description}
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* 注意事項 */}
          <Alert variant="destructive">
            <Info className="h-4 w-4" />
            <AlertDescription>
              選択したフラグメントは消費され、元に戻すことはできません。
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            キャンセル
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!selectedFragmentId || isPending}
            className="gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {isPending ? '作成中...' : '作成する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
