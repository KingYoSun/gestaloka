import { useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { XCircle } from 'lucide-react'

export function SPPurchaseCancel() {
  const navigate = useNavigate()
  const searchParams = new URLSearchParams(window.location.search)
  const purchaseId = searchParams.get('purchase_id')

  return (
    <div className="container mx-auto max-w-2xl py-8">
      <Card>
        <CardHeader className="text-center">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <CardTitle className="text-2xl">購入がキャンセルされました</CardTitle>
          <CardDescription>
            SP購入の手続きがキャンセルされました。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-center text-muted-foreground">
            購入手続きは完了していません。SPは付与されていません。
          </p>

          <div className="flex flex-col gap-3">
            <Button onClick={() => navigate({ to: '/sp' })} className="w-full">
              SP購入ページに戻る
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate({ to: '/game' })}
              className="w-full"
            >
              ゲームに戻る
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
