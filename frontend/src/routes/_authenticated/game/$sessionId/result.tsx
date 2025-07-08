/**
 * セッションリザルト画面
 */
import { createFileRoute } from '@tanstack/react-router'
import { useSessionResult } from '@/hooks/useGameSessions'
import { SessionResult } from '@/components/SessionResult'
import { LoadingScreen } from '@/components/LoadingScreen'
import { ErrorMessage } from '@/components/ErrorMessage'

export const Route = createFileRoute('/_authenticated/game/$sessionId/result')({
  component: SessionResultPage,
})

function SessionResultPage() {
  const { sessionId } = Route.useParams()
  const { data: result, error, isLoading } = useSessionResult(sessionId)

  if (isLoading) {
    return <LoadingScreen message="リザルトを読み込み中..." />
  }

  if (error) {
    return (
      <div className="container mx-auto p-4">
        <ErrorMessage
          title="リザルトの読み込みに失敗しました"
          message={error.message}
          showRetry
          onRetry={() => window.location.reload()}
        />
      </div>
    )
  }

  if (!result) {
    return (
      <div className="container mx-auto p-4">
        <ErrorMessage
          title="リザルトが見つかりません"
          message="セッションのリザルトがまだ処理中か、存在しない可能性があります。"
          showHome
        />
      </div>
    )
  }

  // セッションIDからキャラクターIDを取得する必要がある
  // 実際のアプリケーションでは、セッション情報からキャラクターIDを取得
  const characterId = result.sessionId // 仮の実装

  return <SessionResult result={result} characterId={characterId} />
}
