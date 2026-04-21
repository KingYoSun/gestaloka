import React, { useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { InputWithCounter, TextareaWithCounter } from '@/components/common'
import { Label } from '@/components/ui/label'
import { PlusCircle, Target, AlertCircle } from 'lucide-react'
import { useCreateQuest } from '@/hooks/useQuests'
import { useActiveCharacter } from '@/hooks/useActiveCharacter'
import { QuestOrigin } from '@/types/quest'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'

export const QuestDeclaration: React.FC = () => {
  const { character } = useActiveCharacter()
  const createQuest = useCreateQuest(character?.id)

  const [isOpen, setIsOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!title.trim() || !description.trim()) {
      toast.error('タイトルと説明を入力してください')
      return
    }

    try {
      await createQuest.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        origin: 'player_declared' as QuestOrigin,
      })

      toast.success(`クエストを宣言しました - 「${title}」`)

      // フォームをリセット
      setTitle('')
      setDescription('')
      setIsOpen(false)
    } catch {
      toast.error('クエストの作成に失敗しました')
    }
  }

  if (!character) {
    return null
  }

  if (!isOpen) {
    return (
      <Card
        className="hover:shadow-lg transition-shadow cursor-pointer"
        onClick={() => setIsOpen(true)}
      >
        <CardContent className="py-8 text-center">
          <Button variant="outline" className="gap-2">
            <PlusCircle className="h-4 w-4" />
            新しいクエストを宣言する
          </Button>
          <p className="text-sm text-muted-foreground mt-2">
            自分で目標を設定して、物語を進めましょう
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          新しいクエストの宣言
        </CardTitle>
        <CardDescription>
          あなたが達成したい目標を設定してください
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="quest-title">クエストタイトル</Label>
            <InputWithCounter
              id="quest-title"
              placeholder="例: 伝説の剣を見つける"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={100}
              disabled={createQuest.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="quest-description">詳細な説明</Label>
            <TextareaWithCounter
              id="quest-description"
              placeholder="このクエストで何を達成したいか、どんな冒険をしたいか詳しく書いてください"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              maxLength={2500}
              disabled={createQuest.isPending}
            />
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              宣言したクエストは、あなたの行動に基づいてGMが進行状況を評価します。
              物語の流れに沿った自然な目標を設定することをおすすめします。
            </AlertDescription>
          </Alert>

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsOpen(false)
                setTitle('')
                setDescription('')
              }}
              disabled={createQuest.isPending}
            >
              キャンセル
            </Button>
            <Button
              type="submit"
              disabled={
                createQuest.isPending || !title.trim() || !description.trim()
              }
            >
              {createQuest.isPending ? '作成中...' : 'クエストを宣言'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
