import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlayerSP } from '@/hooks/use-sp'
import { useSPPurchaseStats } from '@/hooks/use-sp-purchase'
import { Coins, TrendingUp, ShoppingBag } from 'lucide-react'

export function SPBalanceCard() {
  const { data: spData, isLoading: isLoadingSP } = usePlayerSP()
  const { data: statsData, isLoading: isLoadingStats } = useSPPurchaseStats()

  if (isLoadingSP || isLoadingStats) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>SP情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </CardContent>
      </Card>
    )
  }

  const spPercentage = spData ? (spData.current_sp / spData.max_sp) * 100 : 0

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ja-JP').format(num)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>SP情報</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">現在のSP</span>
            <span className="font-medium">
              {formatNumber(spData?.current_sp || 0)} / {formatNumber(spData?.max_sp || 0)}
            </span>
          </div>
          <Progress value={spPercentage} className="h-2" />
        </div>

        <div className="grid gap-4 pt-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Coins className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">累計購入SP</p>
              <p className="text-lg font-semibold">
                {formatNumber(statsData?.total_sp_purchased || 0)} SP
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/10 p-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">累計支払額</p>
              <p className="text-lg font-semibold">
                ¥{formatNumber(statsData?.total_spent_jpy || 0)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/10 p-2">
              <ShoppingBag className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">購入回数</p>
              <p className="text-lg font-semibold">
                {statsData?.total_purchases || 0} 回
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}