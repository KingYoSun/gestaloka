import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { useSPPlans } from '@/hooks/use-sp-purchase'
import { SPPlanCard } from './sp-plan-card'
import type { SPPlan } from '@/api/sp-purchase'
import { InfoIcon } from 'lucide-react'

interface SPPlansGridProps {
  onSelectPlan: (plan: SPPlan) => void
}

export function SPPlansGrid({ onSelectPlan }: SPPlansGridProps) {
  const { data, isLoading, error } = useSPPlans()

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-80" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          プラン情報の取得に失敗しました。しばらくしてから再度お試しください。
        </AlertDescription>
      </Alert>
    )
  }

  if (!data?.plans.length) {
    return (
      <Alert>
        <AlertDescription>現在利用可能なプランがありません。</AlertDescription>
      </Alert>
    )
  }

  const isTestMode = data.payment_mode === 'test'

  return (
    <div className="space-y-6">
      {isTestMode && (
        <Alert>
          <InfoIcon className="h-4 w-4" />
          <AlertDescription>
            現在テストモードで動作しています。購入申請時に理由を入力していただくことでSPが付与されます。
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {data.plans.map(plan => (
          <SPPlanCard key={plan.id} plan={plan} onSelect={onSelectPlan} />
        ))}
      </div>
    </div>
  )
}
