import { useState } from 'react'
import { useCharacters } from '@/hooks/useCharacters'
import { LogFragmentList } from './components/LogFragmentList'
import { LogCompilationEditor } from './components/LogCompilationEditor'
import { useLogFragments } from './hooks/useLogFragments'
import { useCreateCompletedLog } from './hooks/useCompletedLogs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BookOpen, Sparkles, User } from 'lucide-react'
import { CompletedLogCreate } from '@/types/log'
import { useToast } from '@/hooks/use-toast'

export function LogsPage() {
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('')
  const [selectedFragmentIds, setSelectedFragmentIds] = useState<string[]>([])
  const [showCompilationEditor, setShowCompilationEditor] = useState(false)
  const { data: characters = [], isLoading: isLoadingCharacters } = useCharacters()
  const { data: fragments = [], isLoading: isLoadingFragments } = useLogFragments(selectedCharacterId)
  const createCompletedLog = useCreateCompletedLog()
  const { toast } = useToast()

  const handleFragmentSelect = (fragmentId: string) => {
    setSelectedFragmentIds((prev) => {
      if (prev.includes(fragmentId)) {
        return prev.filter((id) => id !== fragmentId)
      }
      return [...prev, fragmentId]
    })
  }

  const handleCompile = async (compiledLogData: any) => {
    try {
      // バックエンドAPIの形式に合わせてデータを整形
      const logData: CompletedLogCreate = {
        creatorId: selectedCharacterId,
        coreFragmentId: compiledLogData.coreFragmentId,
        subFragmentIds: compiledLogData.fragmentIds.filter((id: string) => id !== compiledLogData.coreFragmentId),
        name: compiledLogData.name,
        title: compiledLogData.title || undefined,
        description: compiledLogData.description,
        skills: [],  // TODO: スキル抽出ロジックを実装
        personalityTraits: [],  // TODO: 性格特性抽出ロジックを実装
        behaviorPatterns: compiledLogData.behaviorGuidelines ? 
          { guidelines: compiledLogData.behaviorGuidelines } : {},
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
  const selectedFragments = fragments.filter(f => selectedFragmentIds.includes(f.id))

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
        
        <LogCompilationEditor
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
              {characters.map((character) => (
                <Button
                  key={character.id}
                  variant={selectedCharacterId === character.id ? 'default' : 'outline'}
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
    </div>
  )
}