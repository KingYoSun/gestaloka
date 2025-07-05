import { createLazyFileRoute } from '@tanstack/react-router'
import { MemoryInheritanceScreen } from '@/components/memory/MemoryInheritanceScreen'
import { useCharacter } from '@/hooks/useCharacter'

export const Route = createLazyFileRoute('/_authenticated/memory')({
  component: MemoryRoute,
})

function MemoryRoute() {
  const { currentCharacter } = useCharacter()

  if (!currentCharacter) {
    return (
      <div className="container mx-auto p-4">
        <p className="text-center text-muted-foreground">
          キャラクターを選択してください
        </p>
      </div>
    )
  }

  return <MemoryInheritanceScreen characterId={currentCharacter.id} />
}