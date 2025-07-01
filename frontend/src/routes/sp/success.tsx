import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle2 } from 'lucide-react'
import { useSPPurchaseDetail } from '@/hooks/use-sp-purchase'
import { useQueryClient } from '@tanstack/react-query'

export const Route = createFileRoute('/sp/success')({
  component: SPPurchaseSuccess,
})

function SPPurchaseSuccess() {
  const navigate = useNavigate()
  const searchParams = new URLSearchParams(window.location.search)
  const purchaseId = searchParams.get('purchase_id')
  const queryClient = useQueryClient()

  // 購入詳細を取得
  const { data: purchase } = useSPPurchaseDetail(purchaseId || '', !!purchaseId)

  useEffect(() => {
    // SP残高と購入履歴を更新
    queryClient.invalidateQueries({ queryKey: ['sp-balance'] })
    queryClient.invalidateQueries({ queryKey: ['sp-purchases'] })
  }, [queryClient])

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <Card>
        <CardHeader className="text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <CardTitle className="text-2xl">購入が完了しました！</CardTitle>
          <CardDescription>
            SPの購入が正常に完了しました。ご利用ありがとうございます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {purchase && (
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">購入SP</span>
                <span className="font-medium">{purchase.sp_amount} SP</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">支払金額</span>
                <span className="font-medium">
                  {new Intl.NumberFormat('ja-JP', {
                    style: 'currency',
                    currency: 'JPY',
                  }).format(purchase.price_jpy)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">購入日時</span>
                <span className="font-medium">
                  {new Date(purchase.created_at).toLocaleString('ja-JP')}
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Button onClick={() => navigate({ to: '/' })} className="w-full">
              ゲームに戻る
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate({ to: '/sp' })}
              className="w-full"
            >
              購入履歴を見る
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
