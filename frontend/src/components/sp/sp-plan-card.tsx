import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { SPPlan } from '@/api/sp-purchase'
import { Sparkles } from 'lucide-react'

interface SPPlanCardProps {
  plan: SPPlan
  onSelect: (plan: SPPlan) => void
  isLoading?: boolean
}

export function SPPlanCard({ plan, onSelect, isLoading }: SPPlanCardProps) {
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: 'JPY',
    }).format(price)
  }

  const totalSP =
    plan.sp_amount + Math.floor(plan.sp_amount * (plan.bonus_percentage / 100))

  return (
    <Card className={`relative ${plan.popular ? 'ring-2 ring-primary' : ''}`}>
      {plan.popular && (
        <Badge
          className="absolute -top-3 left-1/2 -translate-x-1/2"
          variant="default"
        >
          人気
        </Badge>
      )}

      <CardHeader>
        <CardTitle className="text-lg">{plan.name}</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="text-center">
          <div className="text-3xl font-bold text-primary">{totalSP} SP</div>
          {plan.bonus_percentage > 0 && (
            <div className="text-sm text-muted-foreground">
              {plan.sp_amount} SP +{' '}
              {Math.floor(plan.sp_amount * (plan.bonus_percentage / 100))}{' '}
              ボーナス
            </div>
          )}
        </div>

        <div className="text-center">
          <div className="text-2xl font-semibold">
            {formatPrice(plan.price_jpy)}
          </div>
          <div className="text-sm text-muted-foreground">
            1SPあたり {formatPrice(plan.price_jpy / totalSP)}
          </div>
        </div>

        {plan.bonus_percentage > 0 && (
          <div className="flex items-center justify-center gap-1">
            <Sparkles className="h-4 w-4 text-yellow-500" />
            <span className="text-sm font-medium text-yellow-600">
              {plan.bonus_percentage}% ボーナス
            </span>
          </div>
        )}
      </CardContent>

      <CardFooter>
        <Button
          className="w-full"
          onClick={() => onSelect(plan)}
          disabled={isLoading}
          variant={plan.popular ? 'default' : 'outline'}
        >
          選択
        </Button>
      </CardFooter>
    </Card>
  )
}
