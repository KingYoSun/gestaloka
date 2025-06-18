import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Sparkles, User, Eye, Heart } from 'lucide-react'
import { useCreateCharacter } from '@/hooks/useCharacters'
import { characterCreationSchema, type CharacterCreationFormData } from '@/schemas/character'

export function CharacterCreatePage() {
  const navigate = useNavigate()
  const createCharacterMutation = useCreateCharacter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    watch,
  } = useForm<CharacterCreationFormData>({
    resolver: zodResolver(characterCreationSchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
      description: '',
      appearance: '',
      personality: '',
    },
  })

  const watchedName = watch('name')

  const onSubmit = async (data: CharacterCreationFormData) => {
    if (isSubmitting) return
    
    setIsSubmitting(true)
    try {
      await createCharacterMutation.mutateAsync(data)
      // 成功後はダッシュボードに遷移
      navigate({ to: '/dashboard' })
    } catch (error) {
      console.error('Character creation failed:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <Sparkles className="h-8 w-8 text-purple-600 mr-2" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              キャラクター作成
            </h1>
          </div>
          <p className="text-slate-600 text-lg">
            ゲスタロカの世界へ足を踏み入れるあなたの分身を作成しましょう
          </p>
        </div>

        <Card className="shadow-lg border-0 bg-white/80 backdrop-blur-sm">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center gap-2">
              <User className="h-5 w-5" />
              新しいキャラクター
            </CardTitle>
            <CardDescription>
              あなたの物語の主人公となるキャラクターの詳細を入力してください
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {/* キャラクター名 */}
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium flex items-center gap-2">
                  <User className="h-4 w-4" />
                  キャラクター名 <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="name"
                  {...register('name')}
                  placeholder="例: アリア・シルバーウィンド"
                  className="h-12"
                />
                {errors.name && (
                  <Alert variant="destructive">
                    <AlertDescription>{errors.name.message}</AlertDescription>
                  </Alert>
                )}
                {watchedName && (
                  <p className="text-sm text-green-600">
                    素晴らしい名前ですね！ {watchedName} の物語が始まります。
                  </p>
                )}
              </div>

              {/* 説明 */}
              <div className="space-y-2">
                <Label htmlFor="description" className="text-sm font-medium flex items-center gap-2">
                  <Heart className="h-4 w-4" />
                  キャラクター説明
                </Label>
                <Textarea
                  id="description"
                  {...register('description')}
                  placeholder="このキャラクターの背景や設定を自由に書いてください。どんな人物で、どのような過去を持っているのか..."
                  className="min-h-[100px]"
                />
                {errors.description && (
                  <Alert variant="destructive">
                    <AlertDescription>{errors.description.message}</AlertDescription>
                  </Alert>
                )}
              </div>

              {/* 外見 */}
              <div className="space-y-2">
                <Label htmlFor="appearance" className="text-sm font-medium flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  外見
                </Label>
                <Textarea
                  id="appearance"
                  {...register('appearance')}
                  placeholder="髪の色、瞳の色、身長、服装など、キャラクターの外見的特徴を描写してください..."
                  className="min-h-[100px]"
                />
                {errors.appearance && (
                  <Alert variant="destructive">
                    <AlertDescription>{errors.appearance.message}</AlertDescription>
                  </Alert>
                )}
              </div>

              {/* 性格 */}
              <div className="space-y-2">
                <Label htmlFor="personality" className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  性格
                </Label>
                <Textarea
                  id="personality"
                  {...register('personality')}
                  placeholder="勇敢、慎重、好奇心旺盛、内向的など、キャラクターの性格や特性を書いてください..."
                  className="min-h-[100px]"
                />
                {errors.personality && (
                  <Alert variant="destructive">
                    <AlertDescription>{errors.personality.message}</AlertDescription>
                  </Alert>
                )}
              </div>

              {/* エラー表示 */}
              {createCharacterMutation.isError && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {createCharacterMutation.error?.message || 'キャラクター作成に失敗しました'}
                  </AlertDescription>
                </Alert>
              )}

              {/* 送信ボタン */}
              <div className="flex gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => navigate({ to: '/dashboard' })}
                  disabled={isSubmitting}
                >
                  キャンセル
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                  disabled={!isValid || isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      作成中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      キャラクターを作成
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* ヒント */}
        <Card className="mt-6 bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
          <CardContent className="pt-6">
            <div className="text-center text-sm text-slate-600">
              <p className="mb-2">💡 <strong>ヒント:</strong></p>
              <p>
                詳細な設定ほど、AI GMがより豊かで一貫した物語を紡いでくれます。
                後から設定を変更することも可能です。
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}