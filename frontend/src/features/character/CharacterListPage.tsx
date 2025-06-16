import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { 
  Plus, 
  Users, 
  Sparkles, 
  Eye, 
  Edit3, 
  Trash2, 
  Star,
  Clock,
  MapPin,
  Loader2
} from 'lucide-react'
import { useCharacters, useDeleteCharacter, useActivateCharacter } from '@/hooks/useCharacters'
import { useActiveCharacter } from '@/stores/characterStore'
import { Character } from '@/types'
import { formatRelativeTime } from '@/lib/utils'

export function CharacterListPage() {
  const { data: characters, isLoading, error } = useCharacters()
  const { activeCharacter } = useActiveCharacter()
  const deleteCharacterMutation = useDeleteCharacter()
  const activateCharacterMutation = useActivateCharacter()
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
            <span className="ml-2 text-lg text-slate-600">キャラクターを読み込み中...</span>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <div className="max-w-6xl mx-auto">
          <Alert variant="destructive" className="mt-8">
            <AlertDescription>
              キャラクターの読み込みに失敗しました: {error instanceof Error ? error.message : 'エラーが発生しました'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
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
          <Link to="/character/create">
            <Button className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">
              <Plus className="mr-2 h-4 w-4" />
              新しいキャラクターを作成
            </Button>
          </Link>
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
                  <h3 className="text-xl font-semibold mb-2">まだキャラクターがいません</h3>
                  <p className="text-slate-600 mb-4">
                    最初のキャラクターを作成して、ログバースの世界での冒険を始めましょう！
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
            {characters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                onDelete={() => handleDeleteCharacter(character.id)}
                onActivate={() => handleActivateCharacter(character.id)}
                isDeleting={deletingId === character.id}
                isActivating={activateCharacterMutation.isPending}
                isActive={activeCharacter?.id === character.id}
              />
            ))}
          </div>
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
  isDeleting: boolean
  isActivating: boolean
  isActive: boolean
}

function CharacterCard({ character, onDelete, onActivate, isDeleting, isActivating, isActive }: CharacterCardProps) {
  return (
    <Card className="group hover:shadow-lg transition-all duration-200 bg-white/80 backdrop-blur-sm border-0 shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              {character.name}
              {/* アクティブキャラクターの場合は星アイコン */}
              {isActive && (
                <Star className="h-4 w-4 text-yellow-500 fill-current" />
              )}
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
              <div className="text-xs text-slate-500">Energy</div>
              <div className="font-semibold text-sm">
                {character.stats.energy}/{character.stats.maxEnergy}
              </div>
            </div>
          </div>
        )}

        {/* 作成日時 */}
        <div className="flex items-center text-xs text-slate-500 mb-4">
          <Clock className="h-3 w-3 mr-1" />
          作成: {formatRelativeTime(new Date(character.createdAt))}
        </div>

        {/* アクションボタン */}
        <div className="flex gap-2">
          <Button
            variant={isActive ? "default" : "outline"}
            size="sm"
            className="flex-1"
            onClick={onActivate}
            disabled={isActivating || isActive}
          >
            {isActivating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Star className={`h-3 w-3 ${isActive ? 'fill-current' : ''}`} />
            )}
            <span className="ml-1">{isActive ? 'アクティブ' : '選択'}</span>
          </Button>
          
          <Link to="/character/$id" params={{ id: character.id }}>
            <Button variant="outline" size="sm">
              <Eye className="h-3 w-3" />
            </Button>
          </Link>

          <Button variant="outline" size="sm" disabled>
            <Edit3 className="h-3 w-3" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onDelete}
            disabled={isDeleting}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            {isDeleting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}