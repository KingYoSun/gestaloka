import { apiClient } from '@/lib/api-client'
import {
  CompletedLog,
  CompletedLogCreate,
  CompletedLogRead,
  LogFragment,
  LogFragmentCreate,
  CompilationPreviewRequest,
  CompilationPreviewResponse,
  PurifyLogRequest,
  PurifyLogResponse,
  CreatePurificationItemRequest,
  CreatePurificationItemResponse,
  PurificationItem,
} from '@/types/log'

export type {
  CompletedLog,
  CompletedLogCreate,
  CompletedLogRead,
  LogFragment,
  LogFragmentCreate,
  CompilationPreviewRequest,
  CompilationPreviewResponse,
  PurifyLogRequest,
  PurifyLogResponse,
  CreatePurificationItemRequest,
  CreatePurificationItemResponse,
  PurificationItem,
}

export const logsApi = {
  // ログフラグメント関連
  createFragment: (data: LogFragmentCreate) =>
    apiClient.post<LogFragment>('/logs/fragments', data),

  getFragments: (characterId: string) =>
    apiClient.get<LogFragment[]>(`/logs/fragments/${characterId}`),

  // 完成ログ関連
  createCompletedLog: (data: CompletedLogCreate) =>
    apiClient.post<CompletedLog>('/logs/completed', data),

  updateCompletedLog: (logId: string, data: Partial<CompletedLogCreate>) =>
    apiClient.patch<CompletedLog>(`/logs/completed/${logId}`, data),

  getCompletedLogs: (characterId: string) =>
    apiClient.get<CompletedLogRead[]>(`/logs/completed/${characterId}`),

  // 高度な編纂メカニクス
  previewCompilation: (data: CompilationPreviewRequest) =>
    apiClient.post<CompilationPreviewResponse>('/logs/completed/preview', data),

  purifyLog: (logId: string, data: PurifyLogRequest) =>
    apiClient.post<PurifyLogResponse>(`/logs/completed/${logId}/purify`, data),

  createPurificationItem: (data: CreatePurificationItemRequest) =>
    apiClient.post<CreatePurificationItemResponse>(
      '/logs/fragments/create-purification-item',
      data
    ),

  getPurificationItems: (characterId: string) =>
    apiClient.get<PurificationItem[]>(
      `/logs/purification-items/${characterId}`
    ),
}
