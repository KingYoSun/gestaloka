import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Search, Gem } from 'lucide-react'
import { apiClient } from '@/api/client'
import { useActiveCharacter } from '@/hooks/useActiveCharacter'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  LogFragmentRarity,
  EmotionalValence,
  LogFragment,
} from '@/api/generated'

interface LogFragmentResponse {
  fragments: LogFragment[]
  total: number
  statistics?: {
    total_fragments: number
    unique_keywords: number
    by_rarity: Record<string, number>
  }
}

// レアリティのカラーマッピング
const rarityColors = {
  common: 'bg-gray-500',
  uncommon: 'bg-green-500',
  rare: 'bg-blue-500',
  epic: 'bg-purple-500',
  legendary: 'bg-orange-500',
} as const

// 感情価のアイコンマッピング
const emotionalValenceColors = {
  positive: 'text-green-600',
  negative: 'text-red-600',
  neutral: 'text-gray-600',
  mixed: 'text-yellow-600',
} as const

export function LogFragments() {
  const [searchKeyword, setSearchKeyword] = useState('')
  const [selectedRarity, setSelectedRarity] = useState<
    LogFragmentRarity | 'all'
  >('all')
  const [currentPage, setCurrentPage] = useState(0)
  const pageSize = 20
  const { characterId } = useActiveCharacter()

  // ログフラグメント一覧を取得
  const { data, isLoading, error } = useQuery<LogFragmentResponse>({
    queryKey: [
      'logFragments',
      searchKeyword,
      selectedRarity,
      currentPage,
      characterId,
    ],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (searchKeyword) params.append('keyword', searchKeyword)
      if (selectedRarity !== 'all') params.append('rarity', selectedRarity)
      params.append('limit', pageSize.toString())
      params.append('offset', (currentPage * pageSize).toString())

      return await apiClient.get<LogFragmentResponse>(
        `/api/v1/log-fragments/${characterId}/fragments?${params.toString()}`
      )
    },
    enabled: !!characterId,
  })

  const getRarityLabel = (rarity: LogFragmentRarity) => {
    const labels = {
      common: 'コモン',
      uncommon: 'アンコモン',
      rare: 'レア',
      epic: 'エピック',
      legendary: 'レジェンダリー',
    }
    return labels[rarity]
  }

  const getEmotionalValenceLabel = (valence: EmotionalValence) => {
    const labels = {
      positive: 'ポジティブ',
      negative: 'ネガティブ',
      neutral: 'ニュートラル',
      mixed: 'ミックス',
    }
    return labels[valence]
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-red-600">
        エラーが発生しました: {error.message}
      </div>
    )
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">ログフラグメント</h1>

      {/* 統計情報 */}
      {data?.statistics && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">総フラグメント数</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {data.statistics.total_fragments}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">ユニークキーワード</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {data.statistics.unique_keywords}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">レアリティ分布</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 text-sm">
                {Object.entries(data.statistics.by_rarity).map(
                  ([rarity, count]) => (
                    <div key={rarity} className="flex justify-between">
                      <span className="flex items-center gap-1">
                        <div
                          className={`w-2 h-2 rounded-full ${rarityColors[rarity as LogFragmentRarity]}`}
                        />
                        {getRarityLabel(rarity as LogFragmentRarity)}
                      </span>
                      <span>{count}</span>
                    </div>
                  )
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* フィルター */}
      <div className="flex gap-4 mb-6">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="キーワードで検索..."
              value={searchKeyword}
              onChange={e => setSearchKeyword(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Select
          value={selectedRarity}
          onValueChange={value =>
            setSelectedRarity(value as LogFragmentRarity | 'all')
          }
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="レアリティ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべて</SelectItem>
            <SelectItem value="common">コモン</SelectItem>
            <SelectItem value="uncommon">アンコモン</SelectItem>
            <SelectItem value="rare">レア</SelectItem>
            <SelectItem value="epic">エピック</SelectItem>
            <SelectItem value="legendary">レジェンダリー</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* フラグメント一覧 */}
      <ScrollArea className="h-[calc(100vh-400px)]">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data?.fragments.map(fragment => (
            <Card
              key={fragment.id}
              className="hover:shadow-lg transition-shadow"
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Gem className="w-5 h-5" />
                      {fragment.title}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {fragment.created_at &&
                        `${new Date(fragment.created_at).toLocaleDateString('ja-JP')}に発見`}
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge
                      className={rarityColors[fragment.rarity]}
                      variant="secondary"
                    >
                      {getRarityLabel(fragment.rarity)}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={
                        fragment.emotional_valence
                          ? emotionalValenceColors[fragment.emotional_valence]
                          : 'text-gray-600'
                      }
                    >
                      {fragment.emotional_valence
                        ? getEmotionalValenceLabel(fragment.emotional_valence)
                        : '未設定'}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600 mb-3">{fragment.content}</p>
                <div className="flex flex-wrap gap-1">
                  {fragment.keywords?.map((keyword: string, index: number) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      {keyword}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>

      {/* ページネーション */}
      {data && data.total > pageSize && (
        <div className="flex justify-center gap-2 mt-6">
          <button
            className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
            onClick={() => setCurrentPage(currentPage - 1)}
            disabled={currentPage === 0}
          >
            前へ
          </button>
          <span className="px-4 py-2">
            {currentPage + 1} / {Math.ceil(data.total / pageSize)}
          </span>
          <button
            className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
            onClick={() => setCurrentPage(currentPage + 1)}
            disabled={(currentPage + 1) * pageSize >= data.total}
          >
            次へ
          </button>
        </div>
      )}
    </div>
  )
}
