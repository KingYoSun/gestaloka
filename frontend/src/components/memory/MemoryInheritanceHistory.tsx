import {
  InheritanceHistoryEntry,
  MemoryInheritanceType,
} from '@/api/memoryInheritance'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Sword, Crown, Package, Zap, Clock, Coins } from 'lucide-react'

interface MemoryInheritanceHistoryProps {
  history: InheritanceHistoryEntry[]
}

const typeIcons: Record<MemoryInheritanceType, React.ReactNode> = {
  [MemoryInheritanceType.SKILL]: <Sword className="w-4 h-4" />,
  [MemoryInheritanceType.TITLE]: <Crown className="w-4 h-4" />,
  [MemoryInheritanceType.ITEM]: <Package className="w-4 h-4" />,
  [MemoryInheritanceType.LOG_ENHANCEMENT]: <Zap className="w-4 h-4" />,
}

const typeLabels: Record<MemoryInheritanceType, string> = {
  [MemoryInheritanceType.SKILL]: 'スキル',
  [MemoryInheritanceType.TITLE]: '称号',
  [MemoryInheritanceType.ITEM]: 'アイテム',
  [MemoryInheritanceType.LOG_ENHANCEMENT]: 'ログ強化',
}

const typeColors: Record<MemoryInheritanceType, string> = {
  [MemoryInheritanceType.SKILL]: 'bg-blue-500',
  [MemoryInheritanceType.TITLE]: 'bg-purple-500',
  [MemoryInheritanceType.ITEM]: 'bg-green-500',
  [MemoryInheritanceType.LOG_ENHANCEMENT]: 'bg-orange-500',
}

export function MemoryInheritanceHistory({
  history,
}: MemoryInheritanceHistoryProps) {
  if (history.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>まだ記憶継承を行っていません</p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-[400px] pr-4">
      <div className="space-y-3">
        {history.map(entry => (
          <Card key={entry.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div
                    className={`p-2 rounded-full ${typeColors[entry.inheritance_type]} bg-opacity-20`}
                  >
                    {typeIcons[entry.inheritance_type]}
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      {typeLabels[entry.inheritance_type]}継承
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {format(entry.created_at, 'PPP HH:mm', {
                        locale: ja,
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-sm">
                  <Coins className="w-4 h-4 text-yellow-500" />
                  <span>{entry.sp_consumed} SP</span>
                </div>
              </div>

              <p className="text-sm mb-2">{entry.result_summary}</p>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>使用フラグメント: {entry.fragments_used.length}個</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  )
}
