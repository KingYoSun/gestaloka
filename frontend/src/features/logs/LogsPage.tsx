import { useState } from 'react'
import { useCharacters } from '@/hooks/useCharacters'
import { LogFragmentList } from './components/LogFragmentList'
import { useLogFragments } from './hooks/useLogFragments'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BookOpen, Sparkles, User } from 'lucide-react'

export function LogsPage() {
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('')
  const [selectedFragmentIds, setSelectedFragmentIds] = useState<string[]>([])
  const { data: characters = [], isLoading: isLoadingCharacters } = useCharacters()
  const { data: fragments = [], isLoading: isLoadingFragments } = useLogFragments(selectedCharacterId)

  const handleFragmentSelect = (fragmentId: string) => {
    setSelectedFragmentIds((prev) => {
      if (prev.includes(fragmentId)) {
        return prev.filter((id) => id !== fragmentId)
      }
      return [...prev, fragmentId]
    })
  }

  const selectedCharacter = characters.find(c => c.id === selectedCharacterId)

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
              <Button disabled className="gap-2">
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
