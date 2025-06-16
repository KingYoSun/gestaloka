/**
 * ゲームセッション開始ページ
 */
import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useCharacters } from '@/hooks/useCharacters'
import { useCreateGameSession } from '@/hooks/useGameSessions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, Play, Users } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { toast } from 'sonner'

export const Route = createFileRoute('/game/start')({
  component: GameStartPage,
})

function GameStartPage() {
  const router = useRouter()
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  
  const { data: charactersData, isLoading: charactersLoading } = useCharacters()
  const createSessionMutation = useCreateGameSession()

  const characters = charactersData || []
  const selectedCharacter = characters.find((c) => c.id === selectedCharacterId)

  const handleStartSession = async () => {
    if (!selectedCharacterId) {
      toast.error('キャラクターを選択してください')
      return
    }

    try {
      const session = await createSessionMutation.mutateAsync({
        characterId: selectedCharacterId
      })
      
      toast.success('ゲームセッションを開始しました')
      router.navigate({ to: `/game/${session.id}` })
    } catch (error) {
      console.error('Failed to start game session:', error)
      toast.error('ゲームセッションの開始に失敗しました')
    }
  }

  if (charactersLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            新しい冒険を始める
          </h1>
          <p className="text-muted-foreground">
            冒険に参加するキャラクターを選択してください
          </p>
        </div>

        {characters.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              ゲームを開始するには、まずキャラクターを作成する必要があります。
              <Button 
                variant="link" 
                className="ml-2 p-0 h-auto"
                onClick={() => router.navigate({ to: '/character/create' })}
              >
                キャラクターを作成する
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {characters.map((character) => (
                <Card 
                  key={character.id}
                  className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
                    selectedCharacterId === character.id 
                      ? 'ring-2 ring-primary border-primary' 
                      : 'hover:border-primary/50'
                  }`}
                  onClick={() => setSelectedCharacterId(character.id)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{character.name}</CardTitle>
                      <Badge variant="secondary">
                        Lv.{character.stats?.level || 1}
                      </Badge>
                    </div>
                    <CardDescription>
                      {character.description || 'キャラクターの説明がありません'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-2">
                      <div className="text-sm">
                        <span className="font-medium text-muted-foreground">外見:</span>
                        <p className="text-foreground">{character.appearance || '未設定'}</p>
                      </div>
                      <div className="text-sm">
                        <span className="font-medium text-muted-foreground">性格:</span>
                        <p className="text-foreground">{character.personality || '未設定'}</p>
                      </div>
                      <div className="text-sm">
                        <span className="font-medium text-muted-foreground">現在地:</span>
                        <p className="text-foreground">{character.location || '不明'}</p>
                      </div>
                      {character.stats && (
                        <div className="flex gap-4 text-xs text-muted-foreground pt-2 border-t">
                          <span>HP: {character.stats.health}/{character.stats.maxHealth}</span>
                          <span>MP: {character.stats.energy}/{character.stats.maxEnergy}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {selectedCharacter && (
              <Card className="border-primary/20 bg-primary/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    選択されたキャラクター
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">{selectedCharacter.name}</h3>
                      <p className="text-muted-foreground">
                        {selectedCharacter.description}
                      </p>
                    </div>
                    <Button 
                      onClick={handleStartSession}
                      disabled={createSessionMutation.isPending}
                      size="lg"
                      className="ml-4"
                    >
                      {createSessionMutation.isPending ? (
                        <>
                          <LoadingSpinner size="sm" className="mr-2" />
                          開始中...
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-4 w-4" />
                          冒険を始める
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  )
}