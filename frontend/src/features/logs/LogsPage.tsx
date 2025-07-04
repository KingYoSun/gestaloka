import { useState } from 'react'
import { useCharacters } from '@/hooks/useCharacters'
import { LogFragmentList } from './components/LogFragmentList'
import { AdvancedLogCompilationEditor } from './components/AdvancedLogCompilationEditor'
import { CompletedLogList } from './components/CompletedLogList'
import { CreatePurificationItemDialog } from './components/CreatePurificationItemDialog'
import { useLogFragments } from './hooks/useLogFragments'
import {
  useCreateCompletedLog,
  useCompletedLogs,
} from './hooks/useCompletedLogs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BookOpen, Sparkles, User, ScrollText, Compass, Shield } from 'lucide-react'
import { CompletedLogCreate, CompletedLogRead } from '@/types/log'
import { useToast } from '@/hooks/use-toast'
import { DispatchList } from '@/features/dispatch/components/DispatchList'

export function LogsPage() {
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('')
  const [selectedFragmentIds, setSelectedFragmentIds] = useState<string[]>([])
  const [showCompilationEditor, setShowCompilationEditor] = useState(false)
  const [showPurificationItemDialog, setShowPurificationItemDialog] = useState(false)
  const { data: characters = [], isLoading: isLoadingCharacters } =
    useCharacters()
  const { data: fragments = [], isLoading: isLoadingFragments } =
    useLogFragments(selectedCharacterId)
  const {
    data: completedLogs = [] as CompletedLogRead[],
    isLoading: isLoadingCompletedLogs,
  } = useCompletedLogs(selectedCharacterId)
  const createCompletedLog = useCreateCompletedLog()
  const { toast } = useToast()

  const handleFragmentSelect = (fragmentId: string) => {
    setSelectedFragmentIds(prev => {
      if (prev.includes(fragmentId)) {
        return prev.filter(id => id !== fragmentId)
      }
      return [...prev, fragmentId]
    })
  }

  const handleCompile = async (compiledLogData: {
    coreFragmentId: string
    fragmentIds: string[]
    name: string
    title?: string
    description: string
    isOmnibus: boolean
  }) => {
    try {
      // バックエンドAPIの形式に合わせてデータを整形
      const logData: CompletedLogCreate = {
        creatorId: selectedCharacterId,
        coreFragmentId: compiledLogData.coreFragmentId,
        subFragmentIds: compiledLogData.fragmentIds.filter(
          (id: string) => id !== compiledLogData.coreFragmentId
        ),
        name: compiledLogData.name,
        title: compiledLogData.title || undefined,
        description: compiledLogData.description,
        skills: [], // TODO: スキル抽出ロジックを実装
        personalityTraits: [], // TODO: 性格特性抽出ロジックを実装
        behaviorPatterns: compiledLogData.isOmnibus ? { isOmnibus: true } : {},
      }

      await createCompletedLog.mutateAsync(logData)

      // 成功時の処理
      toast({
        title: 'ログ編纂完了',
        description: 'ログが正常に編纂されました。',
        variant: 'success',
      })

      // UIをリセット
      setShowCompilationEditor(false)
      setSelectedFragmentIds([])
    } catch (error) {
      console.error('Failed to compile log:', error)
      toast({
        title: 'エラー',
        description: 'ログの編纂に失敗しました。',
        variant: 'destructive',
      })
    }
  }

  const selectedCharacter = characters.find(c => c.id === selectedCharacterId)
  const selectedFragments = fragments.filter(f =>
    selectedFragmentIds.includes(f.id)
  )

  // 編纂エディターを表示している場合
  if (showCompilationEditor && selectedFragments.length > 0) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
            <Sparkles className="h-8 w-8" />
            ログ編纂
          </h1>
          <p className="text-muted-foreground">
            選択したフラグメントを組み合わせて、新しいログを作成します。
          </p>
        </div>

        <AdvancedLogCompilationEditor
          fragments={selectedFragments}
          onCompile={handleCompile}
          onCancel={() => {
            setShowCompilationEditor(false)
            setSelectedFragmentIds([])
          }}
        />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <BookOpen className="h-8 w-8" />
          ログシステム
        </h1>
        <p className="text-muted-foreground">
          キャラクターの記録を管理し、ログを編纂してNPCを作成できます。
        </p>
      </div>

      <Tabs defaultValue="fragments" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="fragments" className="gap-2">
            <ScrollText className="h-4 w-4" />
            フラグメント
          </TabsTrigger>
          <TabsTrigger value="completed" className="gap-2">
            <BookOpen className="h-4 w-4" />
            完成ログ
          </TabsTrigger>
          <TabsTrigger value="dispatches" className="gap-2">
            <Compass className="h-4 w-4" />
            派遣状況
          </TabsTrigger>
        </TabsList>

        <TabsContent value="fragments" className="space-y-6">
          {/* キャラクター選択 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                キャラクター選択
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingCharacters ? (
                <p className="text-muted-foreground">読み込み中...</p>
              ) : characters.length === 0 ? (
                <p className="text-muted-foreground">
                  キャラクターがありません。まずキャラクターを作成してください。
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {characters.map(character => (
                    <Button
                      key={character.id}
                      variant={
                        selectedCharacterId === character.id
                          ? 'default'
                          : 'outline'
                      }
                      onClick={() => {
                        setSelectedCharacterId(character.id)
                        setSelectedFragmentIds([])
                      }}
                      className="justify-start"
                    >
                      <User className="h-4 w-4 mr-2" />
                      {character.name}
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ログフラグメント一覧 */}
          {selectedCharacterId && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold">
                  {selectedCharacter?.name} のログフラグメント
                </h2>
                <div className="flex gap-2">
                  {fragments.some(f => f.emotionalValence === 'positive') && (
                    <Button
                      variant="outline"
                      onClick={() => setShowPurificationItemDialog(true)}
                      className="gap-2"
                    >
                      <Shield className="h-4 w-4" />
                      浄化アイテム作成
                    </Button>
                  )}
                  {selectedFragmentIds.length > 0 && (
                    <Button
                      onClick={() => setShowCompilationEditor(true)}
                      className="gap-2"
                    >
                      <Sparkles className="h-4 w-4" />
                      ログを編纂する ({selectedFragmentIds.length})
                    </Button>
                  )}
                </div>
              </div>

              <Card>
                <CardContent className="pt-6">
                  <LogFragmentList
                    fragments={fragments}
                    isLoading={isLoadingFragments}
                    selectedFragmentIds={selectedFragmentIds}
                    onFragmentSelect={handleFragmentSelect}
                    selectionMode="multiple"
                  />
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="completed" className="space-y-6">
          {selectedCharacterId ? (
            <CompletedLogList
              completedLogs={completedLogs as CompletedLogRead[]}
              isLoading={isLoadingCompletedLogs}
            />
          ) : (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-muted-foreground">
                  キャラクターを選択してください
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="dispatches" className="space-y-6">
          <DispatchList />
        </TabsContent>
      </Tabs>

      {/* 浄化アイテム作成ダイアログ */}
      {showPurificationItemDialog && (
        <CreatePurificationItemDialog
          fragments={fragments}
          onClose={() => setShowPurificationItemDialog(false)}
        />
      )}
    </div>
  )
}
