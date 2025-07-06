import { useMutation } from '@tanstack/react-query'
import { logsApi } from '@/api/logs'
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
    mutationFn: data => logsApi.previewCompilation(data),
  })
}
