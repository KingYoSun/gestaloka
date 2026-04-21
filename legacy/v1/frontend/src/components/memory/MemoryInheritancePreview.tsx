import {
  MemoryCombinationPreview,
  MemoryInheritanceType,
} from '@/api/memoryInheritance'
import { Card, CardContent } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Sword, Crown, Package, Zap, Coins } from 'lucide-react'

interface MemoryInheritancePreviewProps {
  preview: MemoryCombinationPreview
  selectedType: MemoryInheritanceType | null
  onSelectType: (type: MemoryInheritanceType) => void
}

const typeIcons: Record<MemoryInheritanceType, React.ReactNode> = {
  skill: <Sword className="w-5 h-5" />,
  title: <Crown className="w-5 h-5" />,
  item: <Package className="w-5 h-5" />,
  log_enhancement: <Zap className="w-5 h-5" />,
}

const typeLabels: Record<MemoryInheritanceType, string> = {
  skill: 'スキル継承',
  title: '称号獲得',
  item: 'アイテム生成',
  log_enhancement: 'ログ強化',
}

export function MemoryInheritancePreview({
  preview,
  selectedType,
  onSelectType,
}: MemoryInheritancePreviewProps) {
  return (
    <div className="space-y-4">
      {/* SP消費情報 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">SP消費</span>
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-yellow-500" />
              <span className="font-bold">
                {selectedType && preview.sp_costs[selectedType]
                  ? `${preview.sp_costs[selectedType]} SP`
                  : '選択してください'}
              </span>
            </div>
          </div>

          {preview.combo_bonus && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-green-600">コンボボーナス</span>
              <span className="text-green-600">{preview.combo_bonus}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* メモリーテーマ（プレビューデータに含まれていない可能性があるため省略） */}

      {/* 継承タイプ選択 */}
      <div className="space-y-3">
        <p className="text-sm font-medium">継承タイプを選択</p>
        <RadioGroup
          value={selectedType || ''}
          onValueChange={(value: string) =>
            onSelectType(value as MemoryInheritanceType)
          }
        >
          <div className="space-y-2">
            {preview.possible_types.map(type => (
              <Label
                key={type}
                htmlFor={type}
                className="flex items-center space-x-2 cursor-pointer"
              >
                <RadioGroupItem value={type} id={type} />
                <Card className="flex-1">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-2">
                      {typeIcons[type as MemoryInheritanceType]}
                      <span className="font-medium">{typeLabels[type as MemoryInheritanceType]}</span>
                    </div>
                    {renderTypePreview(type, preview)}
                  </CardContent>
                </Card>
              </Label>
            ))}
          </div>
        </RadioGroup>
      </div>

      {/* レアリティ分布（データに含まれていない可能性があるため省略） */}
    </div>
  )
}

function renderTypePreview(
  type: string,
  preview: MemoryCombinationPreview
) {
  const previewData = preview.previews[type]
  if (!previewData) return null

  return (
    <div className="space-y-1 text-sm">
      <p className="text-muted-foreground text-xs">
        SP消費: {preview.sp_costs[type] || 0} SP
      </p>
      <p className="text-xs">
        {/* プレビューデータの詳細表示 */}
        詳細はAPIレスポンスに依存
      </p>
    </div>
  )
}
