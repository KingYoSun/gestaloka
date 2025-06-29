import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useSPPurchases, useCancelPurchase } from '@/hooks/use-sp-purchase'
import { PurchaseStatus } from '@/api/sp-purchase'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

export function SPPurchaseHistory() {
  const { data, isLoading, error } = useSPPurchases()
  const { mutate: cancelPurchase, isPending: isCancelling } = useCancelPurchase()

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>購入履歴</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>購入履歴</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              購入履歴の取得に失敗しました。
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: 'JPY',
    }).format(price)
  }

  const getStatusBadge = (status: PurchaseStatus) => {
    const variants: Record<PurchaseStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      [PurchaseStatus.PENDING]: { label: '申請中', variant: 'secondary' },
      [PurchaseStatus.PROCESSING]: { label: '処理中', variant: 'secondary' },
      [PurchaseStatus.COMPLETED]: { label: '完了', variant: 'default' },
      [PurchaseStatus.FAILED]: { label: '失敗', variant: 'destructive' },
      [PurchaseStatus.CANCELLED]: { label: 'キャンセル', variant: 'outline' },
      [PurchaseStatus.REFUNDED]: { label: '返金済み', variant: 'outline' },
    }
    
    const config = variants[status]
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  const canCancel = (status: PurchaseStatus) => {
    return status === PurchaseStatus.PENDING || status === PurchaseStatus.PROCESSING
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>購入履歴</CardTitle>
        <CardDescription>
          過去のSP購入履歴を確認できます
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!data?.purchases.length ? (
          <Alert>
            <AlertDescription>
              購入履歴がありません。
            </AlertDescription>
          </Alert>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日時</TableHead>
                  <TableHead>プラン</TableHead>
                  <TableHead className="text-right">SP</TableHead>
                  <TableHead className="text-right">金額</TableHead>
                  <TableHead>ステータス</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.purchases.map((purchase) => (
                  <TableRow key={purchase.id}>
                    <TableCell>
                      {format(new Date(purchase.created_at), 'MM/dd HH:mm', { locale: ja })}
                    </TableCell>
                    <TableCell>{purchase.plan_id}</TableCell>
                    <TableCell className="text-right font-medium">
                      {purchase.sp_amount} SP
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPrice(purchase.price_jpy)}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(purchase.status)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canCancel(purchase.status) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => cancelPurchase(purchase.id)}
                          disabled={isCancelling}
                        >
                          キャンセル
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}