import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Plus,
  Users,
  Sparkles,
  Edit3,
  Trash2,
  Star,
  Clock,
  MapPin,
  Play,
} from 'lucide-react'
import {
  useCharacters,
  useDeleteCharacter,
  useActivateCharacter,
  useDeactivateCharacter,
} from '@/hooks/useCharacters'
import { useActiveCharacter } from '@/stores/characterStore'
import { useCreateGameSession } from '@/hooks/useGameSessions'
import { Character } from '@/types'
import { formatRelativeTime } from '@/lib/utils'
import { LoadingState } from '@/components/ui/LoadingState'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { containerStyles, cardStyles } from '@/lib/styles'
import { toast } from 'sonner'

export function CharacterListPage() {
  const navigate = useNavigate()
  const { data: characters, isLoading, error } = useCharacters()
  const { activeCharacter } = useActiveCharacter()
  const deleteCharacterMutation = useDeleteCharacter()
  const activateCharacterMutation = useActivateCharacter()
  const deactivateCharacterMutation = useDeactivateCharacter()
  const createSessionMutation = useCreateGameSession()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDeleteCharacter = async (characterId: string) => {
    if (window.confirm('このキャラクターを削除してもよろしいですか？')) {
      setDeletingId(characterId)
      try {
        await deleteCharacterMutation.mutateAsync(characterId)
      } finally {
        setDeletingId(null)
      }
    }
  }

  const handleActivateCharacter = async (characterId: string) => {
    await activateCharacterMutation.mutateAsync(characterId)
  }

  const handleDeactivateCharacter = async () => {
    await deactivateCharacterMutation.mutateAsync()
  }

  const handleStartSession = async () => {
    if (!activeCharacter) {
      toast.error('キャラクターを選択してください')
      return
    }

    try {
      const session = await createSessionMutation.mutateAsync({
        characterId: activeCharacter.id,
      })

      toast.success('ゲームセッションを開始しました')
      navigate({ to: `/game/${session.id}` })
    } catch (error) {
      console.error('Failed to start game session:', error)
      toast.error('ゲームセッションの開始に失敗しました')
    }
  }

  if (isLoading) {
    return (
      <div className={`${containerStyles.pageAlt} p-6`}>
        <div className="max-w-6xl mx-auto">
          <LoadingState message="キャラクターを読み込み中..." />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`${containerStyles.pageAlt} p-6`}>
        <div className="max-w-6xl mx-auto">
          <Alert variant="destructive" className="mt-8">
            <AlertDescription>
              キャラクターの読み込みに失敗しました:{' '}
              {error instanceof Error ? error.message : 'エラーが発生しました'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    )
  }

  return (
    <div className={`${containerStyles.page} p-6`}>
      <div className="max-w-6xl mx-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center">
            <Users className="h-8 w-8 text-purple-600 mr-3" />
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                あなたのキャラクター
              </h1>
              <p className="text-slate-600 mt-1">
                {characters?.length || 0}体のキャラクターが作成されています
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {activeCharacter && (
              <LoadingButton
                onClick={handleStartSession}
                isLoading={createSessionMutation.isPending}
                className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
              >
                <Play className="mr-2 h-4 w-4" />
                冒険を始める
              </LoadingButton>
            )}
            <Link to="/character/create">
              <Button className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">
                <Plus className="mr-2 h-4 w-4" />
                新しいキャラクターを作成
              </Button>
            </Link>
          </div>
        </div>

        {/* キャラクター一覧 */}
        {!characters || characters.length === 0 ? (
          <Card className="text-center py-12 bg-white/80 backdrop-blur-sm">
            <CardContent>
              <div className="flex flex-col items-center space-y-4">
                <div className="w-16 h-16 bg-gradient-to-br from-purple-100 to-blue-100 rounded-full flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-purple-600" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">
                    まだキャラクターがいません
                  </h3>
                  <p className="text-slate-600 mb-4">
                    最初のキャラクターを作成して、ゲスタロカの世界での冒険を始めましょう！
                  </p>
                  <Link to="/character/create">
                    <Button className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">
                      <Plus className="mr-2 h-4 w-4" />
                      キャラクターを作成
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {characters.map(character => (
              <CharacterCard
                key={character.id}
                character={character}
                onDelete={() => handleDeleteCharacter(character.id)}
                onActivate={() => handleActivateCharacter(character.id)}
                onDeactivate={handleDeactivateCharacter}
                onNavigateToEdit={() =>
                  navigate({ to: `/character/${character.id}/edit` })
                }
                isDeleting={deletingId === character.id}
                isActivating={activateCharacterMutation.isPending}
                isDeactivating={deactivateCharacterMutation.isPending}
                isActive={activeCharacter?.id === character.id}
              />
            ))}
          </div>
        )}

        {/* 選択中のキャラクター情報と冒険開始ボタン */}
        {activeCharacter && (
          <Card className="mt-6 border-green-200 bg-green-50/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-800">
                <Star className="h-5 w-5 fill-current" />
                選択中のキャラクター
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg">
                    {activeCharacter.name}
                  </h3>
                  <p className="text-slate-600">
                    {activeCharacter.description ||
                      'キャラクターの説明がありません'}
                  </p>
                  <div className="flex items-center gap-4 mt-2 text-sm text-slate-500">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {activeCharacter.location || '開始の村'}
                    </span>
                    <Badge variant="secondary">
                      Lv.{activeCharacter.stats?.level || 1}
                    </Badge>
                  </div>
                </div>
                <LoadingButton
                  onClick={handleStartSession}
                  isLoading={createSessionMutation.isPending}
                  size="lg"
                  className="ml-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                >
                  <Play className="mr-2 h-4 w-4" />
                  冒険を始める
                </LoadingButton>
              </div>
            </CardContent>
          </Card>
        )}

        {/* キャラクター作成制限の案内 */}
        {characters && characters.length >= 5 && (
          <Alert className="mt-6 bg-amber-50 border-amber-200">
            <AlertDescription className="text-amber-700">
              キャラクターは最大5体まで作成できます。新しいキャラクターを作成するには、既存のキャラクターを削除してください。
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  )
}

interface CharacterCardProps {
  character: Character
  onDelete: () => void
  onActivate: () => void
  onDeactivate: () => void
  onNavigateToEdit: () => void
  isDeleting: boolean
  isActivating: boolean
  isDeactivating: boolean
  isActive: boolean
}

function CharacterCard({
  character,
  onDelete,
  onActivate,
  onDeactivate,
  onNavigateToEdit,
  isDeleting,
  isActivating,
  isDeactivating,
  isActive,
}: CharacterCardProps) {
  return (
    <Card
      className={`group hover:shadow-lg transition-all duration-200 ${cardStyles.transparent} border-0 shadow-md`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg">
              <Link
                to="/character/$id"
                params={{ id: character.id }}
                className="flex items-center gap-2 hover:text-purple-600 transition-colors"
              >
                {character.name}
                {/* アクティブキャラクターの場合は星アイコン */}
                {isActive && (
                  <Star className="h-4 w-4 text-yellow-500 fill-current" />
                )}
              </Link>
            </CardTitle>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="secondary" className="text-xs">
                Lv.{character.stats?.level || 1}
              </Badge>
              <div className="flex items-center text-xs text-slate-500">
                <MapPin className="h-3 w-3 mr-1" />
                {character.location || '開始の村'}
              </div>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* キャラクター説明 */}
        {character.description && (
          <p className="text-sm text-slate-600 mb-4 line-clamp-3">
            {character.description}
          </p>
        )}

        {/* ステータス表示 */}
        {character.stats && (
          <div className="grid grid-cols-2 gap-2 mb-4 p-3 bg-slate-50 rounded-lg">
            <div className="text-center">
              <div className="text-xs text-slate-500">HP</div>
              <div className="font-semibold text-sm">
                {character.stats.health}/{character.stats.maxHealth}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500">MP</div>
              <div className="font-semibold text-sm">
                {character.stats.mp}/{character.stats.maxMp}
              </div>
            </div>
          </div>
        )}

        {/* 最終プレイ時間または作成日時 */}
        <div className="flex items-center text-xs text-slate-500 mb-4">
          <Clock className="h-3 w-3 mr-1" />
          {character.lastPlayedAt
            ? `最終プレイ: ${formatRelativeTime(character.lastPlayedAt)}`
            : `作成: ${formatRelativeTime(character.createdAt)}`}
        </div>

        {/* アクションボタン */}
        <div className="flex gap-2">
          <LoadingButton
            variant={isActive ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={isActive ? onDeactivate : onActivate}
            isLoading={isActive ? isDeactivating : isActivating}
          >
            <Star
              className={`mr-2 h-4 w-4 ${isActive ? 'fill-current' : ''}`}
            />
            {isActive ? '選択中' : '選択'}
          </LoadingButton>

          <Button variant="outline" size="sm" onClick={onNavigateToEdit}>
            <Edit3 className="h-3 w-3" />
          </Button>

          <LoadingButton
            variant="outline"
            size="sm"
            onClick={onDelete}
            isLoading={isDeleting}
            icon={Trash2}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          />
        </div>
      </CardContent>
    </Card>
  )
}
