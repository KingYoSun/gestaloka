import { useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSPPlans } from '@/hooks/use-sp-purchase'
import { SPPlansGrid } from './sp-plans-grid'
import { SPPurchaseDialog } from './sp-purchase-dialog'
import { SPPurchaseHistory } from './sp-purchase-history'
import { SPBalanceCard } from './sp-balance-card'
import type { SPPlan } from '@/api/sp-purchase'

export function SPPurchasePage() {
  const [selectedPlan, setSelectedPlan] = useState<SPPlan | null>(null)
  const [isPurchaseDialogOpen, setIsPurchaseDialogOpen] = useState(false)
  const { data: plansData } = useSPPlans()

  const handleSelectPlan = (plan: SPPlan) => {
    setSelectedPlan(plan)
    setIsPurchaseDialogOpen(true)
  }

  const handleClosePurchaseDialog = () => {
    setIsPurchaseDialogOpen(false)
    setSelectedPlan(null)
  }

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">SP購入</h1>
          <p className="text-muted-foreground mt-2">
            ストーリーポイント（SP）を購入して、ゲスタロカの世界をより深く探索しましょう
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <Tabs defaultValue="plans" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="plans">プラン選択</TabsTrigger>
              <TabsTrigger value="history">購入履歴</TabsTrigger>
            </TabsList>

            <TabsContent value="plans" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>SP購入プラン</CardTitle>
                  <CardDescription>
                    お好みのプランをお選びください。まとめて購入するとボーナスSPが付与されます。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <SPPlansGrid onSelectPlan={handleSelectPlan} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history" className="mt-6">
              <SPPurchaseHistory />
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-6">
          <SPBalanceCard />
        </div>
      </div>

      <SPPurchaseDialog
        plan={selectedPlan}
        isOpen={isPurchaseDialogOpen}
        onClose={handleClosePurchaseDialog}
        isTestMode={plansData?.payment_mode === 'test'}
      />
    </div>
  )
}
