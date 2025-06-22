/**
 * SP取引履歴コンポーネント
 */

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'
import {
  ArrowUpCircle,
  ArrowDownCircle,
  ChevronDown,
  Loader2,
} from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useSPTransactions } from '@/hooks/useSP'
import { SPTransactionType, SPTransactionTypeLabels } from '@/types/sp'
import type { SPTransaction } from '@/types/sp'

interface SPTransactionHistoryProps {
  limit?: number
  className?: string
  relatedEntityType?: string
  relatedEntityId?: string
}

export function SPTransactionHistory({
  limit = 50,
  className,
  relatedEntityType,
  relatedEntityId,
}: SPTransactionHistoryProps) {
  const [transactionType, setTransactionType] = useState<string | undefined>()
  const [offset, setOffset] = useState(0)

  const { data: transactions, isLoading, error } = useSPTransactions({
    transactionType,
    relatedEntityType,
    relatedEntityId,
    limit,
    offset,
  })

  const formatAmount = (amount: number) => {
    const formatted = new Intl.NumberFormat('ja-JP').format(Math.abs(amount))
    return amount >= 0 ? `+${formatted}` : `-${formatted}`
  }

  const getTransactionIcon = (transaction: SPTransaction) => {
    if (transaction.amount >= 0) {
      return <ArrowUpCircle className="h-5 w-5 text-green-500" />
    } else {
      return <ArrowDownCircle className="h-5 w-5 text-red-500" />
    }
  }

  const getTransactionTypeVariant = (type: SPTransactionType) => {
    if (
      [
        SPTransactionType.DAILY_RECOVERY,
        SPTransactionType.PURCHASE,
        SPTransactionType.ACHIEVEMENT,
        SPTransactionType.EVENT_REWARD,
        SPTransactionType.LOG_RESULT,
        SPTransactionType.LOGIN_BONUS,
        SPTransactionType.REFUND,
      ].includes(type as SPTransactionType)
    ) {
      return 'default'
    }
    return 'secondary'
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center p-8 text-destructive">
        取引履歴の読み込みに失敗しました
      </div>
    )
  }

  return (
    <div className={className}>
      {/* フィルター */}
      <div className="flex items-center gap-2 mb-4">
        <Select value={transactionType || 'all'} onValueChange={(value: string) => {
          setTransactionType(value === 'all' ? undefined : value)
          setOffset(0)
        }}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="すべての取引" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべての取引</SelectItem>
            <SelectItem value={SPTransactionType.DAILY_RECOVERY}>
              {SPTransactionTypeLabels[SPTransactionType.DAILY_RECOVERY]}
            </SelectItem>
            <SelectItem value={SPTransactionType.FREE_ACTION}>
              {SPTransactionTypeLabels[SPTransactionType.FREE_ACTION]}
            </SelectItem>
            <SelectItem value={SPTransactionType.LOG_DISPATCH}>
              {SPTransactionTypeLabels[SPTransactionType.LOG_DISPATCH]}
            </SelectItem>
            <SelectItem value={SPTransactionType.PURCHASE}>
              {SPTransactionTypeLabels[SPTransactionType.PURCHASE]}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 取引履歴テーブル */}
      <ScrollArea className="h-[500px] rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]"></TableHead>
              <TableHead>日時</TableHead>
              <TableHead>種別</TableHead>
              <TableHead>説明</TableHead>
              <TableHead className="text-right">増減</TableHead>
              <TableHead className="text-right">残高</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  取引履歴がありません
                </TableCell>
              </TableRow>
            ) : (
              transactions?.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>{getTransactionIcon(transaction)}</TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(transaction.createdAt), {
                        addSuffix: true,
                        locale: ja,
                      })}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getTransactionTypeVariant(transaction.transactionType)}>
                      {SPTransactionTypeLabels[transaction.transactionType]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate">
                    {transaction.description}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <span
                      className={
                        transaction.amount >= 0
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-600 dark:text-red-400'
                      }
                    >
                      {formatAmount(transaction.amount)} SP
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {new Intl.NumberFormat('ja-JP').format(transaction.balanceAfter)} SP
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>詳細情報</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <div className="p-2 text-sm space-y-1">
                          <p>
                            <span className="text-muted-foreground">取引ID:</span>{' '}
                            <span className="font-mono text-xs">{transaction.id.slice(0, 8)}...</span>
                          </p>
                          <p>
                            <span className="text-muted-foreground">日時:</span>{' '}
                            {new Date(transaction.createdAt).toLocaleString('ja-JP')}
                          </p>
                          {transaction.transactionMetadata && Object.keys(transaction.transactionMetadata).length > 0 && (
                            <p>
                              <span className="text-muted-foreground">メタデータ:</span>{' '}
                              <span className="font-mono text-xs">
                                {JSON.stringify(transaction.transactionMetadata)}
                              </span>
                            </p>
                          )}
                        </div>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* ページネーション */}
      {transactions && transactions.length >= limit && (
        <div className="flex items-center justify-between mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
          >
            前へ
          </Button>
          <span className="text-sm text-muted-foreground">
            {offset + 1} - {offset + transactions.length} 件
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(offset + limit)}
            disabled={transactions.length < limit}
          >
            次へ
          </Button>
        </div>
      )}
    </div>
  )
}