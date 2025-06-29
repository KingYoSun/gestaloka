/**
 * SPシステムページ
 */

import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Coins, History, TrendingUp, Calendar, RefreshCw } from 'lucide-react'
import { useSPBalance, useDailyRecovery } from '@/hooks/useSP'
import { SPDisplay } from '@/components/sp/SPDisplay'
import { SPTransactionHistory } from '@/components/sp/SPTransactionHistory'
import { SPPlansGrid } from '@/components/sp/sp-plans-grid'
import { SPPurchaseDialog } from '@/components/sp/sp-purchase-dialog'
import { SPPurchaseHistory } from '@/components/sp/sp-purchase-history'
import { useSPPlans } from '@/hooks/use-sp-purchase'
import type { SPPlan } from '@/api/sp-purchase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/sp/')({
  component: SPPage,
})

function SPPage() {
  const { data: balance, isLoading } = useSPBalance()
  const dailyRecovery = useDailyRecovery()
  const { data: plansData } = useSPPlans()
  const [activeTab, setActiveTab] = useState('overview')
  const [selectedPlan, setSelectedPlan] = useState<SPPlan | null>(null)
  const [isPurchaseDialogOpen, setIsPurchaseDialogOpen] = useState(false)

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ja-JP').format(num)
  }

  const handleDailyRecovery = async () => {
    try {
      await dailyRecovery.mutateAsync()
    } catch {
      // エラーはuseMutationで処理
    }
  }

  const handleSelectPlan = (plan: SPPlan) => {
    setSelectedPlan(plan)
    setIsPurchaseDialogOpen(true)
  }

  const handleClosePurchaseDialog = () => {
    setIsPurchaseDialogOpen(false)
    setSelectedPlan(null)
  }

  if (isLoading) {
    return (
      <div className="container max-w-6xl py-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    )
  }

  if (!balance) {
    return (
      <div className="container max-w-6xl py-8">
        <div className="text-center py-12">
          <p className="text-muted-foreground">SP情報の読み込みに失敗しました</p>
        </div>
      </div>
    )
  }

  const consumptionRate = balance.totalEarnedSp > 0
    ? (balance.totalConsumedSp / balance.totalEarnedSp) * 100
    : 0

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Coins className="h-8 w-8 text-yellow-500" />
            ストーリーポイント (SP)
          </h1>
          <p className="text-muted-foreground mt-1">
            SPを使って世界により深く干渉し、あなただけの物語を紡ぎましょう
          </p>
        </div>
        <Button
          onClick={handleDailyRecovery}
          disabled={dailyRecovery.isPending}
          variant="outline"
          className="gap-2"
        >
          {dailyRecovery.isPending ? (
            <>
              <LoadingSpinner size="sm" />
              処理中...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              日次回復
            </>
          )}
        </Button>
      </div>

      {/* 統計カード */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">現在の残高</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(balance.currentSp)} SP</div>
            <p className="text-xs text-muted-foreground">
              利用可能なストーリーポイント
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">総獲得量</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(balance.totalEarnedSp)} SP</div>
            <p className="text-xs text-muted-foreground">
              これまでに獲得した総SP
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">総消費量</CardTitle>
            <History className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(balance.totalConsumedSp)} SP</div>
            <Progress value={consumptionRate} className="h-2 mt-2" />
            <p className="text-xs text-muted-foreground mt-1">
              獲得量の {consumptionRate.toFixed(1)}% を消費
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">連続ログイン</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{balance.consecutiveLoginDays} 日</div>
            <p className="text-xs text-muted-foreground">
              {balance.consecutiveLoginDays >= 30
                ? '最大ボーナス獲得中！'
                : balance.consecutiveLoginDays >= 14
                ? '14日ボーナス獲得中'
                : balance.consecutiveLoginDays >= 7
                ? '7日ボーナス獲得中'
                : '連続ログインでボーナスSP'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* タブコンテンツ */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">概要</TabsTrigger>
          <TabsTrigger value="history">取引履歴</TabsTrigger>
          <TabsTrigger value="shop">SPショップ</TabsTrigger>
          <TabsTrigger value="purchase-history">購入履歴</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <SPDisplay showSubscription className="h-full" />
            
            <Card>
              <CardHeader>
                <CardTitle>SPの使い道</CardTitle>
                <CardDescription>
                  SPを使って、より深い物語体験を楽しめます
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">自由行動（短い）</span>
                  <span className="text-sm font-medium">1-2 SP</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">自由行動（標準）</span>
                  <span className="text-sm font-medium">3 SP</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">自由行動（複雑）</span>
                  <span className="text-sm font-medium">5 SP</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">ログ派遣（短期）</span>
                  <span className="text-sm font-medium">10-30 SP</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">ログ派遣（長期）</span>
                  <span className="text-sm font-medium">80-300 SP</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>取引履歴</CardTitle>
              <CardDescription>
                SPの獲得・消費履歴を確認できます
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SPTransactionHistory />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shop">
          <Card>
            <CardHeader>
              <CardTitle>SPショップ</CardTitle>
              <CardDescription>
                SPを購入して、より多くの物語を体験しましょう
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SPPlansGrid onSelectPlan={handleSelectPlan} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="purchase-history">
          <SPPurchaseHistory />
        </TabsContent>
      </Tabs>

      <SPPurchaseDialog
        plan={selectedPlan}
        isOpen={isPurchaseDialogOpen}
        onClose={handleClosePurchaseDialog}
        isTestMode={plansData?.payment_mode === 'test'}
      />
    </div>
  )
}