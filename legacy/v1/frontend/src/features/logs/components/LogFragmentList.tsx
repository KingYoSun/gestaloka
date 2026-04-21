import { useState, useMemo } from 'react'
import { LogFragmentCard } from './LogFragmentCard'
import { LogFragment, EmotionalValence, LogFragmentRarity } from '@/types/log'
import { Input } from '@/components/ui/input'
import { Loader2, Search } from 'lucide-react'

interface LogFragmentListProps {
  fragments: LogFragment[]
  isLoading?: boolean
  selectedFragmentIds?: string[]
  onFragmentSelect?: (fragmentId: string) => void
  selectionMode?: 'single' | 'multiple'
}

type SortOption = 'date' | 'importance' | 'rarity'
type FilterOption = 'all' | EmotionalValence | LogFragmentRarity

export function LogFragmentList({
  fragments,
  isLoading = false,
  selectedFragmentIds = [],
  onFragmentSelect,
  selectionMode = 'single',
}: LogFragmentListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [emotionFilter, setEmotionFilter] = useState<FilterOption>('all')
  const [rarityFilter, setRarityFilter] = useState<FilterOption>('all')
  const [sortBy, setSortBy] = useState<SortOption>('date')

  // フィルタリングとソート
  const processedFragments = useMemo(() => {
    let filtered = fragments

    // 検索フィルタ
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        fragment =>
          fragment.actionDescription.toLowerCase().includes(query) ||
          fragment.keywords.some(keyword =>
            keyword.toLowerCase().includes(query)
          )
      )
    }

    // 感情価フィルタ
    if (emotionFilter !== 'all') {
      filtered = filtered.filter(
        fragment => fragment.emotionalValence === emotionFilter
      )
    }

    // レアリティフィルタ
    if (rarityFilter !== 'all') {
      filtered = filtered.filter(fragment => fragment.rarity === rarityFilter)
    }

    // ソート
    const sorted = [...filtered]
    switch (sortBy) {
      case 'date':
        sorted.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        break
      case 'importance':
        sorted.sort((a, b) => b.importanceScore - a.importanceScore)
        break
      case 'rarity': {
        const rarityOrder = ['legendary', 'epic', 'rare', 'uncommon', 'common']
        sorted.sort(
          (a, b) =>
            rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity)
        )
        break
      }
    }

    return sorted
  }, [fragments, searchQuery, emotionFilter, rarityFilter, sortBy])

  const handleFragmentClick = (fragmentId: string) => {
    if (!onFragmentSelect) return

    if (selectionMode === 'multiple') {
      onFragmentSelect(fragmentId)
    } else {
      // シングル選択モードでは、既に選択されている場合は選択解除
      if (selectedFragmentIds.includes(fragmentId)) {
        onFragmentSelect('')
      } else {
        onFragmentSelect(fragmentId)
      }
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* フィルタとソート */}
      <div className="space-y-4 bg-background/50 p-4 rounded-lg">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="行動やキーワードで検索..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <select
            value={emotionFilter}
            onChange={e => setEmotionFilter(e.target.value as FilterOption)}
            className="px-3 py-2 rounded-md border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="all">すべての感情価</option>
            <option value="positive">肯定的</option>
            <option value="negative">否定的</option>
            <option value="neutral">中立</option>
          </select>

          <select
            value={rarityFilter}
            onChange={e => setRarityFilter(e.target.value as FilterOption)}
            className="px-3 py-2 rounded-md border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="all">すべてのレアリティ</option>
            <option value="legendary">レジェンダリー</option>
            <option value="epic">エピック</option>
            <option value="rare">レア</option>
            <option value="uncommon">アンコモン</option>
            <option value="common">コモン</option>
          </select>

          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortOption)}
            className="px-3 py-2 rounded-md border border-gray-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="date">日付順</option>
            <option value="importance">重要度順</option>
            <option value="rarity">レアリティ順</option>
          </select>
        </div>
      </div>

      {/* 結果表示 */}
      <div className="text-sm text-muted-foreground">
        {processedFragments.length} 件のログフラグメント
        {selectedFragmentIds.length > 0 &&
          ` (${selectedFragmentIds.length} 件選択中)`}
      </div>

      {/* フラグメントカード */}
      {processedFragments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          該当するログフラグメントが見つかりません
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {processedFragments.map(fragment => (
            <LogFragmentCard
              key={fragment.id}
              fragment={fragment}
              isSelected={selectedFragmentIds.includes(fragment.id)}
              onClick={() => handleFragmentClick(fragment.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
