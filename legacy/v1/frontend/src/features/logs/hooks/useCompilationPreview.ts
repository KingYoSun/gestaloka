import { useMutation } from '@tanstack/react-query'
// import { logsApiWrapper } from '@/api/logs' // TODO: API実装後に有効化
import type {
  CompilationPreviewRequest,
  CompilationPreviewResponse,
} from '@/types/log'

export function useCompilationPreview() {
  return useMutation<
    CompilationPreviewResponse,
    Error,
    CompilationPreviewRequest
  >({
    mutationFn: async () => {
      // previewCompilation APIは現在未実装
      throw new Error('編纂プレビュー機能は現在利用できません')
    },
  })
}
