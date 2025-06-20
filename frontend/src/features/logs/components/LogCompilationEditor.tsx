import { useState, useEffect } from 'react'
import { LogFragment } from '@/types/log'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  AlertTriangle,
  Sparkles,
  Star,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface LogCompilationEditorProps {
  fragments: LogFragment[]
  onCompile: (compiledLog: any) => void
  onCancel: () => void
}

export function LogCompilationEditor({
  fragments,
  onCompile,
  onCancel,
}: LogCompilationEditorProps) {
  const [coreFragmentId, setCoreFragmentId] = useState<string>('')
  const [selectedFragmentIds, setSelectedFragmentIds] = useState<string[]>([])
  const [logName, setLogName] = useState('')
  const [logTitle, setLogTitle] = useState('')
  const [logDescription, setLogDescription] = useState('')
  const [behaviorGuidelines, setBehaviorGuidelines] = useState('')
  const [contaminationLevel, setContaminationLevel] = useState(0)

  // フラグメントIDのリストから実際のフラグメントオブジェクトを取得
  const selectedFragments = fragments.filter((f) =>
    selectedFragmentIds.includes(f.id)
  )
  const coreFragment = fragments.find((f) => f.id === coreFragmentId)

  // 初期化
  useEffect(() => {
    if (fragments.length > 0 && !coreFragmentId) {
      // 最も重要度の高いフラグメントをコアに設定
      const sortedByImportance = [...fragments].sort(
        (a, b) => b.importanceScore - a.importanceScore
      )
      setCoreFragmentId(sortedByImportance[0].id)
      setSelectedFragmentIds(fragments.map((f) => f.id))
    }
  }, [fragments, coreFragmentId])

  // 汚染度の計算
  useEffect(() => {
    if (selectedFragments.length === 0) {
      setContaminationLevel(0)
      return
    }

    const negativeCount = selectedFragments.filter(
      (f) => f.emotionalValence === 'negative'
    ).length
    const contamination = negativeCount / selectedFragments.length
    setContaminationLevel(contamination)
  }, [selectedFragments])

  // 自動提案の生成
  useEffect(() => {
    if (!coreFragment) return

    // ログ名の自動提案
    if (!logName) {
      const keywords = coreFragment.keywords.slice(0, 2).join('と')
      setLogName(`${keywords}の記録`)
    }

    // タイトルの自動提案
    if (!logTitle) {
      const rarityTitles = {
        common: '冒険者',
        uncommon: '経験者',
        rare: '探求者',
        epic: '英雄',
        legendary: '伝説',
      }
      setLogTitle(rarityTitles[coreFragment.rarity])
    }

    // 説明の自動生成
    if (!logDescription && selectedFragments.length > 0) {
      const keywordSet = new Set<string>()
      selectedFragments.forEach((f) => f.keywords.forEach((k) => keywordSet.add(k)))
      const allKeywords = Array.from(keywordSet).slice(0, 5).join('、')
      setLogDescription(
        `${allKeywords}に関わる${selectedFragments.length}つの記憶から編纂されたログ。`
      )
    }
  }, [coreFragment, selectedFragments, logName, logTitle, logDescription])

  const handleFragmentToggle = (fragmentId: string) => {
    if (fragmentId === coreFragmentId) return // コアフラグメントは削除不可

    setSelectedFragmentIds((prev) =>
      prev.includes(fragmentId)
        ? prev.filter((id) => id !== fragmentId)
        : [...prev, fragmentId]
    )
  }

  const handleCompile = () => {
    if (!coreFragmentId || selectedFragmentIds.length === 0) return

    // onCompileに渡すデータは既存の形式を保持（LogsPageで変換）
    const compiledLogData = {
      coreFragmentId,
      fragmentIds: selectedFragmentIds,
      name: logName,
      title: logTitle,
      description: logDescription,
      behaviorGuidelines,
    }

    onCompile(compiledLogData)
  }

  const isValid =
    coreFragmentId &&
    selectedFragmentIds.length > 0 &&
    logName &&
    logTitle &&
    logDescription

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
            {fragments.map((fragment) => {
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
                          onClick={(e) => {
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

      {/* 右側：ログ編集 */}
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
                onChange={(e) => setLogName(e.target.value)}
                placeholder="例：勇気と友情の記録"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="logTitle">称号</Label>
              <Input
                id="logTitle"
                value={logTitle}
                onChange={(e) => setLogTitle(e.target.value)}
                placeholder="例：不屈の探求者"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="logDescription">説明</Label>
              <Textarea
                id="logDescription"
                value={logDescription}
                onChange={(e) => setLogDescription(e.target.value)}
                placeholder="このログの内容を説明してください"
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="behaviorGuidelines">
                行動指針（オプション）
              </Label>
              <Textarea
                id="behaviorGuidelines"
                value={behaviorGuidelines}
                onChange={(e) => setBehaviorGuidelines(e.target.value)}
                placeholder="NPCとして活動する際の行動指針を記述"
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        {/* 汚染度表示 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              汚染度
              {contaminationLevel > 0.5 && (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Progress
                value={contaminationLevel * 100}
                className={cn(
                  'h-3',
                  contaminationLevel > 0.7 && '[&>div]:bg-red-500',
                  contaminationLevel > 0.5 &&
                    contaminationLevel <= 0.7 &&
                    '[&>div]:bg-yellow-500',
                  contaminationLevel <= 0.5 && '[&>div]:bg-green-500'
                )}
              />
              <p className="text-sm text-muted-foreground">
                {Math.round(contaminationLevel * 100)}% -{' '}
                {contaminationLevel > 0.7
                  ? '高度に汚染されています'
                  : contaminationLevel > 0.5
                  ? '中程度の汚染'
                  : contaminationLevel > 0.3
                  ? '軽度の汚染'
                  : '清浄'}
              </p>
              {contaminationLevel > 0.5 && (
                <p className="text-xs text-yellow-600">
                  高い汚染度のログは予測不能な行動を取る可能性があります
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* アクションボタン */}
        <div className="flex gap-4">
          <Button
            variant="outline"
            onClick={onCancel}
            className="flex-1"
          >
            キャンセル
          </Button>
          <Button
            onClick={handleCompile}
            disabled={!isValid}
            className="flex-1 gap-2"
          >
            <Sparkles className="h-4 w-4" />
            ログを編纂
          </Button>
        </div>
      </div>
    </div>
  )
}