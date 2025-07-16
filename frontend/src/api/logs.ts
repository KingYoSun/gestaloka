import { logFragmentsApi, logsApi } from '@/lib/api'
import type {
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
} from '@/api/generated/models'

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

export const logsApiWrapper = {
  // ログフラグメント関連
  createFragment: async (data: LogFragmentCreate) => {
    const response = await logsApi.createLogFragmentApiV1LogsFragmentsPost({ logFragmentCreate: data })
    return response.data
  },

  getFragments: async (characterId: string) => {
    const response = await logFragmentsApi.getCharacterFragmentsApiV1LogFragmentsCharacterIdFragmentsGet({ characterId })
    return response.data
  },

  // 完成ログ関連
  createCompletedLog: async (data: CompletedLogCreate) => {
    const response = await logsApi.createCompletedLogApiV1LogsCompletedPost({ completedLogCreate: data })
    return response.data
  },

  updateCompletedLog: async (logId: string, data: Partial<CompletedLogCreate>) => {
    const response = await logsApi.updateCompletedLogApiV1LogsCompletedLogIdPatch({ logId, completedLogUpdate: data })
    return response.data
  },

  getCompletedLogs: async (characterId: string) => {
    const response = await logsApi.getCharacterLogsApiV1LogsCompletedCharacterIdGet({ characterId })
    return response.data
  },

  // 高度な編纂メカニクス
  previewCompilation: async (data: CompilationPreviewRequest) => {
    const response = await logsApi.previewCompilationApiV1LogsCompletedPreviewPost({ compilationPreviewRequest: data })
    return response.data
  },

  purifyLog: async (logId: string, data: PurifyLogRequest) => {
    const response = await logsApi.purifyLogApiV1LogsCompletedLogIdPurifyPost({ logId, purifyLogRequest: data })
    return response.data
  },

  createPurificationItem: async (data: CreatePurificationItemRequest) => {
    const response = await logFragmentsApi.createPurificationItemApiV1LogFragmentsCreatePurificationItemPost({ createPurificationItemRequest: data })
    return response.data
  },

  getPurificationItems: async (characterId: string) => {
    const response = await logFragmentsApi.getPurificationItemsApiV1LogPurificationItemsCharacterIdGet({ characterId })
    return response.data
  },
}