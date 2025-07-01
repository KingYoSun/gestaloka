import { apiClient } from '@/lib/api-client'
import {
  CompletedLog,
  CompletedLogCreate,
  CompletedLogRead,
  LogFragment,
  LogFragmentCreate,
} from '@/types/log'

export type {
  CompletedLog,
  CompletedLogCreate,
  CompletedLogRead,
  LogFragment,
  LogFragmentCreate,
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

}
