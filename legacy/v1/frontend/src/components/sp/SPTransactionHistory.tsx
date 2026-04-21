import { useState } from 'react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { useQuery } from '@tanstack/react-query'
import { spApi } from '@/lib/api'
import type { SPTransactionType } from '@/api/generated/models'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

const transactionTypeLabels: Record<SPTransactionType, string> = {
  daily_recovery: '日次回復',
  purchase: '購入',
  achievement: '実績報酬',
  event_reward: 'イベント報酬',
  log_result: 'ログ結果',
  login_bonus: 'ログインボーナス',
  refund: '返金',
  free_action: '自由行動',
  log_dispatch: 'ログ派遣',
  log_enhancement: 'ログ強化',
  memory_inheritance: '記憶継承',
  system_function: 'システム機能',
  movement: '移動',
  exploration: '探索',
  adjustment: '調整',
  migration: 'マイグレーション',
  admin_grant: '管理者付与',
  admin_deduct: '管理者減算',
}

const transactionTypeColors: Record<string, string> = {
  daily_recovery: 'bg-green-100 text-green-800',
  purchase: 'bg-blue-100 text-blue-800',
  achievement: 'bg-purple-100 text-purple-800',
  event_reward: 'bg-yellow-100 text-yellow-800',
  log_result: 'bg-indigo-100 text-indigo-800',
  login_bonus: 'bg-green-100 text-green-800',
  refund: 'bg-orange-100 text-orange-800',
  free_action: 'bg-red-100 text-red-800',
  log_dispatch: 'bg-red-100 text-red-800',
  log_enhancement: 'bg-red-100 text-red-800',
  memory_inheritance: 'bg-red-100 text-red-800',
  system_function: 'bg-gray-100 text-gray-800',
  movement: 'bg-red-100 text-red-800',
  exploration: 'bg-red-100 text-red-800',
  adjustment: 'bg-gray-100 text-gray-800',
  migration: 'bg-gray-100 text-gray-800',
  admin_grant: 'bg-green-100 text-green-800',
  admin_deduct: 'bg-red-100 text-red-800',
}

export function SPTransactionHistory() {
  const [filterType, setFilterType] = useState<SPTransactionType | 'all'>('all')
  const [limit] = useState(50)

  const { data: transactions, isLoading, error } = useQuery({
    queryKey: ['sp', 'transactions', filterType, limit],
    queryFn: async () => {
      const response = await spApi.getTransactionHistoryApiV1SpTransactionsGet({
        transactionType: filterType === 'all' ? undefined : filterType,
        limit,
      })
      return response.data
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        取引履歴の読み込みに失敗しました
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Select
          value={filterType}
          onValueChange={(value) => setFilterType(value as SPTransactionType | 'all')}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="取引タイプで絞り込み" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべて</SelectItem>
            {Object.entries(transactionTypeLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="h-[400px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日時</TableHead>
              <TableHead>種類</TableHead>
              <TableHead className="text-right">金額</TableHead>
              <TableHead className="text-right">残高</TableHead>
              <TableHead>説明</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions && transactions.length > 0 ? (
              transactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell className="whitespace-nowrap">
                    {format(new Date(transaction.created_at), 'MM/dd HH:mm', { locale: ja })}
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant="secondary" 
                      className={transactionTypeColors[transaction.transaction_type] || ''}
                    >
                      {transactionTypeLabels[transaction.transaction_type as SPTransactionType]}
                    </Badge>
                  </TableCell>
                  <TableCell className={`text-right font-medium ${
                    transaction.amount > 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {transaction.amount > 0 ? '+' : ''}{transaction.amount}
                  </TableCell>
                  <TableCell className="text-right">
                    {transaction.balance_after}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {transaction.description || '-'}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  取引履歴がありません
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  )
}