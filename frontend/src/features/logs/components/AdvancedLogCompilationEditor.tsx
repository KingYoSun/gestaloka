import { useState, useEffect } from 'react'
import { LogFragment, MemoryType } from '@/types/log'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertTriangle,
  Sparkles,
  Star,
  Coins,
  Shield,
  Zap,
  Award,
  Heart,
  Info,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCompilationPreview } from '../hooks/useCompilationPreview'
import { usePlayerSP } from '@/features/sp/hooks/usePlayerSP'

interface AdvancedLogCompilationEditorProps {
  fragments: LogFragment[]
  onCompile: (compiledLog: {
    coreFragmentId: string
    fragmentIds: string[]
    name: string
    title?: string
    description: string
    isOmnibus: boolean
  }) => void
  onCancel: () => void
}

// 記憶タイプの日本語表示
const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  COURAGE: '勇気',
  FRIENDSHIP: '友情',
  WISDOM: '知恵',
  SACRIFICE: '犠牲',
  VICTORY: '勝利',
  TRUTH: '真実',
  BETRAYAL: '裏切り',
  LOVE: '愛',
  FEAR: '恐怖',
  HOPE: '希望',
  MYSTERY: '謎',
}

// ボーナスタイプのアイコン
const BONUS_TYPE_ICONS = {
  SP_COST_REDUCTION: Coins,
  POWER_BOOST: Zap,
  SPECIAL_TITLE: Award,
  PURIFICATION: Shield,
  RARITY_UPGRADE: Star,
  MEMORY_RESONANCE: Heart,
}

export function AdvancedLogCompilationEditor({
  fragments,
  onCompile,
  onCancel,
}: AdvancedLogCompilationEditorProps) {
  const [coreFragmentId, setCoreFragmentId] = useState<string>('')
  const [selectedFragmentIds, setSelectedFragmentIds] = useState<string[]>([])
  const [logName, setLogName] = useState('')
  const [logTitle, setLogTitle] = useState('')
  const [logDescription, setLogDescription] = useState('')

  const { mutate: previewCompilation, data: previewData, isPending: isPreviewLoading } =
    useCompilationPreview()
  const { data: playerSP } = usePlayerSP()

  // フラグメントIDのリストから実際のフラグメントオブジェクトを取得
  const selectedFragments = fragments.filter(f =>
    selectedFragmentIds.includes(f.id)
  )
  const coreFragment = fragments.find(f => f.id === coreFragmentId)

  // 初期化
  useEffect(() => {
    if (fragments.length > 0 && !coreFragmentId) {
      // 最も重要度の高いフラグメントをコアに設定
      const sortedByImportance = [...fragments].sort(
        (a, b) => b.importanceScore - a.importanceScore
      )
      setCoreFragmentId(sortedByImportance[0].id)
      setSelectedFragmentIds(fragments.map(f => f.id))
    }
  }, [fragments, coreFragmentId])

  // 編纂プレビューの取得
  useEffect(() => {
    if (coreFragmentId && selectedFragmentIds.length > 0) {
      const subFragmentIds = selectedFragmentIds.filter(id => id !== coreFragmentId)
      previewCompilation({
        core_fragment_id: coreFragmentId,
        sub_fragment_ids: subFragmentIds,
      })
    }
  }, [coreFragmentId, selectedFragmentIds, previewCompilation])

  // 自動提案の生成
  useEffect(() => {
    if (!coreFragment) return

    // ログ名の自動提案
    if (!logName) {
      const keywords = coreFragment.keywords.slice(0, 2).join('と')
      setLogName(`${keywords}の記録`)
    }

    // タイトルの自動提案（特殊称号がある場合は優先）
    if (!logTitle && previewData?.special_titles.length) {
      setLogTitle(previewData.special_titles[0])
    } else if (!logTitle) {
      const rarityTitles = {
        common: '冒険者',
        uncommon: '経験者',
        rare: '探求者',
        epic: '英雄',
        legendary: '伝説',
        unique: '唯一無二',
        architect: '世界の設計者',
      }
      setLogTitle(rarityTitles[coreFragment.rarity])
    }

    // 説明の自動生成
    if (!logDescription && selectedFragments.length > 0) {
      const keywordSet = new Set<string>()
      selectedFragments.forEach(f => f.keywords.forEach(k => keywordSet.add(k)))
      const allKeywords = Array.from(keywordSet).slice(0, 5).join('、')
      setLogDescription(
        `${allKeywords}に関わる${selectedFragments.length}つの記憶から編纂されたログ。`
      )
    }
  }, [coreFragment, selectedFragments, previewData, logName, logTitle, logDescription])

  const handleFragmentToggle = (fragmentId: string) => {
    if (fragmentId === coreFragmentId) return // コアフラグメントは削除不可

    setSelectedFragmentIds(prev =>
      prev.includes(fragmentId)
        ? prev.filter(id => id !== fragmentId)
        : [...prev, fragmentId]
    )
  }

  const handleCompile = () => {
    if (!coreFragmentId || selectedFragmentIds.length === 0) return

    // SP残高の確認
    if (playerSP && previewData && playerSP.currentSp < previewData.final_sp_cost) {
      alert('SPが不足しています')
      return
    }

    const compiledLogData = {
      coreFragmentId,
      fragmentIds: selectedFragmentIds,
      name: logName,
      title: logTitle,
      description: logDescription,
      isOmnibus: selectedFragmentIds.length > 3,
    }

    onCompile(compiledLogData)
  }

  const isValid =
    coreFragmentId &&
    selectedFragmentIds.length > 0 &&
    logName &&
    logTitle &&
    logDescription

  // SPコストの計算
  const canAfford = playerSP && previewData
    ? playerSP.currentSp >= previewData.final_sp_cost
    : true

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 左側：フラグメント選択 */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>ログフラグメント選択</CardTitle>
            <p className="text-sm text-muted-foreground">
              コアフラグメントを選び、組み合わせるフラグメントを選択してください
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {fragments.map(fragment => {
              const isCore = fragment.id === coreFragmentId
              const isSelected = selectedFragmentIds.includes(fragment.id)

              return (
                <div
                  key={fragment.id}
                  className={cn(
                    'p-4 rounded-lg border transition-all cursor-pointer',
                    isCore && 'ring-2 ring-yellow-500 bg-yellow-50',
                    isSelected && !isCore && 'bg-primary/5 border-primary',
                    !isSelected && !isCore && 'hover:bg-gray-50'
                  )}
                  onClick={() => !isCore && handleFragmentToggle(fragment.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        {isCore && (
                          <Badge variant="default" className="bg-yellow-500">
                            <Star className="h-3 w-3 mr-1" />
                            コア
                          </Badge>
                        )}
                        <Badge variant="secondary">{fragment.rarity}</Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            fragment.emotionalValence === 'positive' &&
                              'text-green-600',
                            fragment.emotionalValence === 'negative' &&
                              'text-red-600'
                          )}
                        >
                          {fragment.emotionalValence}
                        </Badge>
                        {fragment.memoryType && (
                          <Badge variant="outline" className="text-purple-600">
                            {MEMORY_TYPE_LABELS[fragment.memoryType]}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm line-clamp-2">
                        {fragment.actionDescription}
                      </p>
                      <div className="flex gap-1 mt-2">
                        {fragment.keywords.slice(0, 3).map((keyword, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {keyword}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {!isCore && (
                        <Button
                          size="sm"
                          variant={isCore ? 'default' : 'outline'}
                          onClick={e => {
                            e.stopPropagation()
                            setCoreFragmentId(fragment.id)
                          }}
                        >
                          コアに設定
                        </Button>
                      )}
                      <span className="text-xs text-muted-foreground">
                        重要度: {Math.round(fragment.importanceScore * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      {/* 右側：ログ編集とプレビュー */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>ログ情報の編集</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="logName">ログ名</Label>
              <Input
                id="logName"
                value={logName}
                onChange={e => setLogName(e.target.value)}
                placeholder="例：勇気と友情の記録"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="logTitle">称号</Label>
              <Input
                id="logTitle"
                value={logTitle}
                onChange={e => setLogTitle(e.target.value)}
                placeholder="例：不屈の探求者"
              />
              {previewData?.special_titles && previewData.special_titles.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {previewData?.special_titles?.map((title, i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                      className="cursor-pointer"
                      onClick={() => setLogTitle(title)}
                    >
                      <Award className="h-3 w-3 mr-1" />
                      {title}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="logDescription">説明</Label>
              <Textarea
                id="logDescription"
                value={logDescription}
                onChange={e => setLogDescription(e.target.value)}
                placeholder="このログの内容を説明してください"
                rows={4}
              />
            </div>
          </CardContent>
        </Card>

        {/* SP消費とボーナス表示 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5" />
              SP消費とボーナス
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isPreviewLoading ? (
              <div className="text-center py-4 text-muted-foreground">
                計算中...
              </div>
            ) : previewData ? (
              <>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>基本SP消費</span>
                    <span>{previewData.base_sp_cost} SP</span>
                  </div>
                  {previewData.base_sp_cost !== previewData.final_sp_cost && (
                    <>
                      <div className="flex justify-between text-sm text-green-600">
                        <span>ボーナス削減</span>
                        <span>
                          -{previewData.base_sp_cost - previewData.final_sp_cost} SP
                        </span>
                      </div>
                      <Separator />
                    </>
                  )}
                  <div className="flex justify-between font-semibold">
                    <span>最終SP消費</span>
                    <span className={cn(!canAfford && 'text-red-600')}>
                      {previewData.final_sp_cost} SP
                    </span>
                  </div>
                  {playerSP && (
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>現在のSP</span>
                      <span>{playerSP.currentSp} SP</span>
                    </div>
                  )}
                </div>

                {/* コンボボーナス表示 */}
                {previewData.bonuses.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">獲得ボーナス</h4>
                    {previewData.bonuses.map((bonus, i) => {
                      const Icon = BONUS_TYPE_ICONS[bonus.type] || Sparkles
                      return (
                        <Alert key={i} className="py-2">
                          <Icon className="h-4 w-4" />
                          <AlertDescription className="ml-2">
                            {bonus.description}
                            {bonus.value && ` (${bonus.value}%)`}
                          </AlertDescription>
                        </Alert>
                      )
                    })}
                  </div>
                )}

                {/* 警告表示 */}
                {previewData.warnings.length > 0 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      {previewData.warnings.join(' ')}
                    </AlertDescription>
                  </Alert>
                )}
              </>
            ) : (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  フラグメントを選択すると、SP消費とボーナスが表示されます
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* 汚染度表示 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              汚染度
              {previewData && previewData.contamination_level > 0.5 && (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Progress
                value={(previewData?.contamination_level || 0) * 100}
                className={cn(
                  'h-3',
                  previewData &&
                    previewData.contamination_level > 0.7 &&
                    '[&>div]:bg-red-500',
                  previewData &&
                    previewData.contamination_level > 0.5 &&
                    previewData.contamination_level <= 0.7 &&
                    '[&>div]:bg-yellow-500',
                  previewData &&
                    previewData.contamination_level <= 0.5 &&
                    '[&>div]:bg-green-500'
                )}
              />
              <p className="text-sm text-muted-foreground">
                {Math.round((previewData?.contamination_level || 0) * 100)}% -{' '}
                {previewData
                  ? previewData.contamination_level > 0.7
                    ? '高度に汚染されています'
                    : previewData.contamination_level > 0.5
                      ? '中程度の汚染'
                      : previewData.contamination_level > 0.3
                        ? '軽度の汚染'
                        : '清浄'
                  : '計算中...'}
              </p>
              {previewData && previewData.contamination_level > 0.5 && (
                <p className="text-xs text-yellow-600">
                  高い汚染度のログは予測不能な行動を取る可能性があります
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* アクションボタン */}
        <div className="flex gap-4">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            キャンセル
          </Button>
          <Button
            onClick={handleCompile}
            disabled={!isValid || !canAfford}
            className="flex-1 gap-2"
          >
            <Sparkles className="h-4 w-4" />
            ログを編纂
            {previewData && ` (${previewData.final_sp_cost} SP)`}
          </Button>
        </div>
      </div>
    </div>
  )
}