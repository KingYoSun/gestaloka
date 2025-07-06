/**
 * Title card component for displaying a single character title
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Crown, Calendar, Sparkles } from 'lucide-react'
import { CharacterTitle } from '@/api/titles'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

interface TitleCardProps {
  title: CharacterTitle
  isEquipped: boolean
  onEquip: (titleId: string) => void
  onUnequip: () => void
  isEquipping?: boolean
  isUnequipping?: boolean
}

export const TitleCard = ({
  title,
  isEquipped,
  onEquip,
  onUnequip,
  isEquipping,
  isUnequipping,
}: TitleCardProps) => {
  const handleToggleEquip = () => {
    if (isEquipped) {
      onUnequip()
    } else {
      onEquip(title.id)
    }
  }

  return (
    <Card className={isEquipped ? 'border-primary shadow-lg' : ''}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">{title.title}</CardTitle>
            {isEquipped && (
              <Badge variant="default" className="flex items-center gap-1">
                <Crown className="h-3 w-3" />
                装備中
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant={isEquipped ? 'outline' : 'default'}
            onClick={handleToggleEquip}
            disabled={isEquipping || isUnequipping}
          >
            {isEquipped ? '外す' : '装備する'}
          </Button>
        </div>
        <CardDescription>{title.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {title.effects && Object.keys(title.effects).length > 0 && (
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div className="text-sm text-muted-foreground">
                {Object.entries(title.effects).map(([key, value]) => (
                  <p key={key}>
                    {key}: {value}
                  </p>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>
              獲得日:{' '}
              {format(title.acquired_at, 'yyyy年MM月dd日', { locale: ja })}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
