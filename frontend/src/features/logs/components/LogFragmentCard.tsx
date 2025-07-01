import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LogFragment, EmotionalValence, LogFragmentRarity } from '@/types/log'
import { cn } from '@/lib/utils'

interface LogFragmentCardProps {
  fragment: LogFragment
  isSelected?: boolean
  onClick?: () => void
  className?: string
}

// レアリティに応じた色設定
const rarityColors: Record<LogFragmentRarity, string> = {
  common: 'bg-gray-500',
  uncommon: 'bg-green-500',
  rare: 'bg-blue-500',
  epic: 'bg-purple-500',
  legendary: 'bg-yellow-500',
}

// 感情価に応じたアイコンと色設定
const emotionalValenceConfig: Record<
  EmotionalValence,
  { label: string; color: string; icon: string }
> = {
  positive: { label: '肯定的', color: 'text-green-600', icon: '😊' },
  negative: { label: '否定的', color: 'text-red-600', icon: '😔' },
  neutral: { label: '中立', color: 'text-gray-600', icon: '😐' },
}

export function LogFragmentCard({
  fragment,
  isSelected = false,
  onClick,
  className,
}: LogFragmentCardProps) {
  const emotionConfig = emotionalValenceConfig[fragment.emotionalValence]
  const importancePercentage = Math.round(fragment.importanceScore * 100)

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all hover:shadow-lg',
        isSelected && 'ring-2 ring-primary',
        className
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className={cn('text-white', rarityColors[fragment.rarity])}
            >
              {fragment.rarity}
            </Badge>
            <span className={cn('text-sm', emotionConfig.color)}>
              {emotionConfig.icon} {emotionConfig.label}
            </span>
          </div>
          <div className="text-sm text-muted-foreground">
            重要度: {importancePercentage}%
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm mb-3 line-clamp-3">
          {fragment.actionDescription}
        </p>
        <div className="flex flex-wrap gap-1">
          {fragment.keywords.map((keyword, index) => (
            <Badge key={index} variant="outline" className="text-xs">
              {keyword}
            </Badge>
          ))}
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          {new Date(fragment.createdAt).toLocaleString('ja-JP')}
        </div>
      </CardContent>
    </Card>
  )
}
