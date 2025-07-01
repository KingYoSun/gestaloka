import { useState, useEffect } from 'react'
import { useCharacterStore } from '@/store/characterStore'
import { NarrativeInterface } from '@/features/narrative/NarrativeInterface'
import { Card } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'

export function GamePage() {
  const { selectedCharacter, fetchCharacters } = useCharacterStore()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const loadCharacter = async () => {
      if (!selectedCharacter) {
        await fetchCharacters()
      }
      setIsLoading(false)
    }
    loadCharacter()
  }, [selectedCharacter, fetchCharacters])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!selectedCharacter) {
    return (
      <div className="p-6">
        <Card className="p-8 text-center">
          <h2 className="text-xl font-semibold mb-4">
            キャラクターが選択されていません
          </h2>
          <p className="text-muted-foreground">
            ダッシュボードからキャラクターを選択してください。
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 h-full">
      <h1 className="text-3xl font-bold mb-6">
        {selectedCharacter.name}の物語
      </h1>
      <NarrativeInterface characterId={selectedCharacter.id} />
    </div>
  )
}
