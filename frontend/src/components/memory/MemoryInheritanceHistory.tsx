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
  skill: <Sword className="w-4 h-4" />,
  title: <Crown className="w-4 h-4" />,
  item: <Package className="w-4 h-4" />,
  log_enhancement: <Zap className="w-4 h-4" />,
}

const typeLabels: Record<MemoryInheritanceType, string> = {
  skill: 'スキル',
  title: '称号',
  item: 'アイテム',
  log_enhancement: 'ログ強化',
}

const typeColors: Record<MemoryInheritanceType, string> = {
  skill: 'bg-blue-500',
  title: 'bg-purple-500',
  item: 'bg-green-500',
  log_enhancement: 'bg-orange-500',
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
                    className={`p-2 rounded-full ${typeColors[entry.inheritance_type as MemoryInheritanceType]} bg-opacity-20`}
                  >
                    {typeIcons[entry.inheritance_type as MemoryInheritanceType]}
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      {typeLabels[entry.inheritance_type as MemoryInheritanceType]}継承
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {format(new Date(entry.timestamp), 'PPP HH:mm', {
                        locale: ja,
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-sm">
                  <Coins className="w-4 h-4 text-yellow-500" />
                  <span>{/* TODO: SP消費量の表示 */}</span>
                </div>
              </div>

              <p className="text-sm mb-2">{/* TODO: 結果サマリーの表示 */}</p>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>使用フラグメント: {entry.fragment_ids.length}個</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  )
}
