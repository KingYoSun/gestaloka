import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/useToast'
import { Loader2, Search, Plus, Minus, History } from 'lucide-react'
import {
  adminSPManagementApi,
  PlayerSPDetail,
  AdminSPAdjustment,
} from '@/api/admin/spManagement'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

export function SPManagement() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [adjustDialog, setAdjustDialog] = useState<{
    open: boolean
    player?: PlayerSPDetail
  }>({ open: false })
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [historyDialog, setHistoryDialog] = useState<{
    open: boolean
    userId?: string
  }>({ open: false })

  // Fetch players SP data
  const { data: players, isLoading } = useQuery({
    queryKey: ['admin', 'sp', 'players', search],
    queryFn: () =>
      adminSPManagementApi.getAllPlayersSP({ search: search || undefined }),
  })

  // Adjust SP mutation
  const adjustMutation = useMutation({
    mutationFn: (adjustment: AdminSPAdjustment) =>
      adminSPManagementApi.adjustPlayerSP(adjustment),
    onSuccess: data => {
      toast({
        title: 'SP調整完了',
        description: `${data.username}のSPを${data.adjustment_amount > 0 ? '+' : ''}${data.adjustment_amount}調整しました。`,
      })
      queryClient.invalidateQueries({ queryKey: ['admin', 'sp'] })
      setAdjustDialog({ open: false })
      setAdjustAmount('')
      setAdjustReason('')
    },
    onError: (error: any) => {
      toast({
        title: 'エラー',
        description: error.response?.data?.detail || 'SP調整に失敗しました。',
        variant: 'destructive',
      })
    },
  })

  const handleAdjust = () => {
    if (!adjustDialog.player || !adjustAmount) return

    const amount = parseInt(adjustAmount)
    if (isNaN(amount) || amount === 0) {
      toast({
        title: 'エラー',
        description: '有効な数値を入力してください。',
        variant: 'destructive',
      })
      return
    }

    adjustMutation.mutate({
      user_id: adjustDialog.player.user_id,
      amount,
      reason: adjustReason || undefined,
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">SP管理</h2>
        <p className="text-muted-foreground">
          プレイヤーのSP（ストーリーポイント）を管理・調整できます。
        </p>
      </div>

      {/* Search */}
      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="ユーザー名またはメールで検索..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      {/* Players Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ユーザー名</TableHead>
              <TableHead>メールアドレス</TableHead>
              <TableHead className="text-right">現在のSP</TableHead>
              <TableHead className="text-right">総獲得</TableHead>
              <TableHead className="text-right">総消費</TableHead>
              <TableHead className="text-right">連続ログイン</TableHead>
              <TableHead>最終日次回復</TableHead>
              <TableHead className="text-center">アクション</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : players?.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center py-8 text-muted-foreground"
                >
                  プレイヤーが見つかりません
                </TableCell>
              </TableRow>
            ) : (
              players?.map(player => (
                <TableRow key={player.user_id}>
                  <TableCell className="font-medium">
                    {player.username}
                  </TableCell>
                  <TableCell>{player.email}</TableCell>
                  <TableCell className="text-right font-mono">
                    {player.current_sp.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {player.total_earned.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {player.total_consumed.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">
                      {player.consecutive_login_days}日
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {player.last_daily_recovery
                      ? format(
                          new Date(player.last_daily_recovery),
                          'M/d HH:mm',
                          {
                            locale: ja,
                          }
                        )
                      : '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center space-x-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAdjustDialog({ open: true, player })}
                      >
                        調整
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setHistoryDialog({
                            open: true,
                            userId: String(player.user_id),
                          })
                        }
                      >
                        <History className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* SP Adjustment Dialog */}
      <Dialog
        open={adjustDialog.open}
        onOpenChange={open => setAdjustDialog({ open })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>SP調整</DialogTitle>
            <DialogDescription>
              {adjustDialog.player?.username} のSPを調整します。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>現在のSP</Label>
              <div className="text-2xl font-mono font-bold">
                {adjustDialog.player?.current_sp.toLocaleString()} SP
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjust-amount">調整量</Label>
              <div className="flex items-center space-x-2">
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setAdjustAmount('-')}
                  type="button"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  id="adjust-amount"
                  type="number"
                  value={adjustAmount}
                  onChange={e => setAdjustAmount(e.target.value)}
                  placeholder="例: 100 or -50"
                  className="text-center"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setAdjustAmount('+')}
                  type="button"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                正の値で付与、負の値で減算
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjust-reason">理由（任意）</Label>
              <Textarea
                id="adjust-reason"
                value={adjustReason}
                onChange={e => setAdjustReason(e.target.value)}
                placeholder="例: イベント報酬、バグ補填など"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAdjustDialog({ open: false })
                setAdjustAmount('')
                setAdjustReason('')
              }}
            >
              キャンセル
            </Button>
            <Button
              onClick={handleAdjust}
              disabled={!adjustAmount || adjustMutation.isPending}
            >
              {adjustMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              調整実行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transaction History Dialog */}
      <TransactionHistoryDialog
        open={historyDialog.open}
        userId={historyDialog.userId}
        onOpenChange={open => setHistoryDialog({ open })}
      />
    </div>
  )
}

// Transaction History Dialog Component
function TransactionHistoryDialog({
  open,
  userId,
  onOpenChange,
}: {
  open: boolean
  userId?: string
  onOpenChange: (open: boolean) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'sp', 'transactions', userId],
    queryFn: () =>
      userId
        ? adminSPManagementApi.getPlayerTransactions(userId, { limit: 50 })
        : null,
    enabled: !!userId && open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>SP取引履歴</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日時</TableHead>
                  <TableHead>種別</TableHead>
                  <TableHead className="text-right">金額</TableHead>
                  <TableHead className="text-right">残高</TableHead>
                  <TableHead>説明</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.transactions.map(tx => (
                  <TableRow key={tx.id}>
                    <TableCell>
                      {tx.created_at
                        ? format(tx.created_at, 'M/d HH:mm', {
                            locale: ja,
                          })
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={tx.amount > 0 ? 'default' : 'secondary'}>
                        {tx.transaction_type}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono ${
                        tx.amount > 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {tx.amount > 0 ? '+' : ''}
                      {tx.amount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {tx.balance_after.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">
                      {tx.description || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
