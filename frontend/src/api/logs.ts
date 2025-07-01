import { apiClient } from '@/lib/api-client'
import {
  CompletedLog,
  CompletedLogCreate,
  CompletedLogRead,
  LogContract,
  LogContractCreate,
  LogFragment,
  LogFragmentCreate,
} from '@/types/log'

export type {
  CompletedLog,
  CompletedLogCreate,
  CompletedLogRead,
  LogContract,
  LogContractCreate,
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

  // ログ契約関連
  createContract: (data: LogContractCreate) =>
    apiClient.post<LogContract>('/logs/contracts', data),

  getMarketContracts: () =>
    apiClient.get<LogContract[]>('/logs/contracts/market'),

  acceptContract: (contractId: string, characterId: string) =>
    apiClient.post<LogContract>(`/logs/contracts/${contractId}/accept`, {
      character_id: characterId,
    }),
}
