import { useState } from 'react'
import { useParams, useNavigate, Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  ArrowLeft,
  Edit3,
  Trash2,
  Star,
  MapPin,
  Calendar,
  Heart,
  Zap,
  Shield,
  Sword,
  Eye,
  User,
  Sparkles,
} from 'lucide-react'
import {
  useCharacters,
  useCharacter,
  useDeleteCharacter,
  useActivateCharacter,
  useDeactivateCharacter,
} from '@/hooks/useCharacters'
import { useCreateGameSession, useGameSessions } from '@/hooks/useGameSessions'
import { useActiveCharacter } from '@/stores/characterStore'
import { formatDate, formatRelativeTime } from '@/lib/utils'
import { LoadingState, LoadingSpinner } from '@/components/ui/loading-spinner'
import { containerStyles } from '@/lib/styles'
import { toast } from 'sonner'
import { Play } from 'lucide-react'

export function CharacterDetailPage() {
  const { id } = useParams({ from: '/_authenticated/character/$id' })
  const navigate = useNavigate()
  // キャラクター一覧をストアに読み込む（activeCharacterの取得に必要）
  useCharacters()
  const { data: character, isLoading, error } = useCharacter(id)
  const { activeCharacter } = useActiveCharacter()
  const deleteCharacterMutation = useDeleteCharacter()
  const activateCharacterMutation = useActivateCharacter()
  const deactivateCharacterMutation = useDeactivateCharacter()
  const createSessionMutation = useCreateGameSession()
  const [isDeleting, setIsDeleting] = useState(false)

  // セッション履歴を取得
  const { data: sessions } = useGameSessions()

  const handleDeleteCharacter = async () => {
    if (!character) return

    if (
      window.confirm(
        `${character.name}を削除してもよろしいですか？この操作は取り消せません。`
      )
    ) {
      setIsDeleting(true)
      try {
        await deleteCharacterMutation.mutateAsync(character.id)
        navigate({ to: '/characters' })
      } finally {
        setIsDeleting(false)
      }
    }
  }

  const handleActivateCharacter = async () => {
    if (!character) return
    await activateCharacterMutation.mutateAsync(character.id)
  }

  const handleDeactivateCharacter = async () => {
    await deactivateCharacterMutation.mutateAsync()
  }

  const handleStartSession = async () => {
    if (!character) return

    // アクティブセッションがある場合はそのセッションへ遷移
    const activeSession = sessions?.sessions?.find(
      s => s.characterId === character.id && s.isActive
    )
    if (activeSession) {
      navigate({ to: `/game/${activeSession.id}` })
      return
    }

    try {
      const session = await createSessionMutation.mutateAsync({
        characterId: character.id,
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
        <div className={containerStyles.maxWidth}>
          <LoadingState message="キャラクター情報を読み込み中..." />
        </div>
      </div>
    )
  }

  if (error || !character) {
    return (
      <div className={`${containerStyles.pageAlt} p-6`}>
        <div className={containerStyles.maxWidth}>
          <Alert variant="destructive" className="mt-8">
            <AlertDescription>
              キャラクター情報の読み込みに失敗しました:{' '}
              {error instanceof Error
                ? error.message
                : 'キャラクターが見つかりません'}
            </AlertDescription>
          </Alert>
          <div className="mt-4">
            <Link to="/characters">
              <Button variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                キャラクター一覧に戻る
              </Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // キャラクターデータが確実に存在する時点でisActiveを判定
  const isActive = activeCharacter?.id === character.id

  return (
    <div className={`${containerStyles.page} p-6`}>
      <div className={containerStyles.maxWidth}>
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center">
            <Link to="/characters">
              <Button variant="outline" size="sm" className="mr-4">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold text-slate-800">
                  {character.name}
                </h1>
                <Badge variant="secondary" className="text-sm">
                  Lv.{character.stats?.level || 1}
                </Badge>
              </div>
              <div className="flex items-center text-slate-600 mt-1">
                <MapPin className="h-4 w-4 mr-1" />
                {character.location || '開始の村'}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            {isActive && (
              <Button
                onClick={handleStartSession}
                disabled={createSessionMutation.isPending}
                className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
              >
                {createSessionMutation.isPending ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2" />
                    読み込み中...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    {sessions?.sessions?.find(
                      s => s.characterId === character.id && s.isActive
                    )
                      ? '冒険を再開'
                      : '冒険を始める'}
                  </>
                )}
              </Button>
            )}
            <Button
              onClick={
                isActive ? handleDeactivateCharacter : handleActivateCharacter
              }
              disabled={
                isActive
                  ? deactivateCharacterMutation.isPending
                  : activateCharacterMutation.isPending
              }
              className={
                isActive
                  ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700'
                  : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700'
              }
            >
              {(
                isActive
                  ? deactivateCharacterMutation.isPending
                  : activateCharacterMutation.isPending
              ) ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  処理中...
                </>
              ) : (
                <>
                  <Star
                    className={`mr-2 h-4 w-4 ${isActive ? 'fill-current' : ''}`}
                  />
                  {isActive ? '選択中' : '選択'}
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate({ to: `/character/${id}/edit` })}
            >
              <Edit3 className="mr-2 h-4 w-4" />
              編集
            </Button>
            <Button
              variant="outline"
              onClick={handleDeleteCharacter}
              disabled={isDeleting}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              {isDeleting ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  削除中...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  削除
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* 左カラム - キャラクター情報 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 基本情報 */}
            <Card className="shadow-lg border-0 bg-white/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-purple-600" />
                  基本情報
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {character.description && (
                  <div>
                    <h4 className="font-medium text-slate-700 mb-2">説明</h4>
                    <p className="text-slate-600 leading-relaxed">
                      {character.description}
                    </p>
                  </div>
                )}

                {character.appearance && (
                  <div>
                    <h4 className="font-medium text-slate-700 mb-2 flex items-center gap-1">
                      <Eye className="h-4 w-4" />
                      外見
                    </h4>
                    <p className="text-slate-600 leading-relaxed">
                      {character.appearance}
                    </p>
                  </div>
                )}

                {character.personality && (
                  <div>
                    <h4 className="font-medium text-slate-700 mb-2 flex items-center gap-1">
                      <Sparkles className="h-4 w-4" />
                      性格
                    </h4>
                    <p className="text-slate-600 leading-relaxed">
                      {character.personality}
                    </p>
                  </div>
                )}

                <Separator />

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-slate-500" />
                    <div>
                      <div className="font-medium">作成日</div>
                      <div className="text-slate-600">
                        {formatDate(character.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-slate-500" />
                    <div>
                      <div className="font-medium">最終更新</div>
                      <div className="text-slate-600">
                        {formatRelativeTime(character.updatedAt)}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* スキル */}
            {character.skills && character.skills.length > 0 && (
              <Card className="shadow-lg border-0 bg-white/80 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sword className="h-5 w-5 text-blue-600" />
                    スキル
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3">
                    {character.skills.map(skill => (
                      <div
                        key={skill.id}
                        className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{skill.name}</span>
                            <Badge variant="outline" className="text-xs">
                              Lv.{skill.level}
                            </Badge>
                          </div>
                          {skill.description && (
                            <p className="text-sm text-slate-600 mt-1">
                              {skill.description}
                            </p>
                          )}
                        </div>
                        <div className="text-sm text-slate-500">
                          EXP: {skill.experience}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* 右カラム - ステータス */}
          <div className="space-y-6">
            {/* ステータス */}
            {character.stats && (
              <Card className="shadow-lg border-0 bg-white/80 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-green-600" />
                    ステータス
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-center mb-4">
                    <div className="text-2xl font-bold text-purple-600">
                      レベル {character.stats.level}
                    </div>
                    <div className="text-sm text-slate-600">
                      EXP: {character.stats.experience}
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Heart className="h-4 w-4 text-red-500" />
                        <span className="font-medium">HP</span>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">
                          {character.stats.health} / {character.stats.maxHealth}
                        </div>
                        <div className="w-20 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-red-500 transition-all duration-300"
                            style={{
                              width: `${(character.stats.health / character.stats.maxHealth) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-blue-500" />
                        <span className="font-medium">MP</span>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">
                          {character.stats.mp} / {character.stats.maxMp}
                        </div>
                        <div className="w-20 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-all duration-300"
                            style={{
                              width: `${(character.stats.mp / character.stats.maxMp) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
