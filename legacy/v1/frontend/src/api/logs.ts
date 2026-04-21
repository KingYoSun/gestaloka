import { logFragmentsApi, logsApi } from '@/lib/api'
import type {
  CompletedLogRead,
  CompletedLogCreate,
  LogFragmentRead,
  LogFragmentCreate,
} from '@/api/generated/models'

export type {
  CompletedLogRead,
  CompletedLogRead as CompletedLog, // 互換性のためのエイリアス
  CompletedLogCreate,
  LogFragmentRead,
  LogFragmentRead as LogFragment, // 互換性のためのエイリアス
  LogFragmentCreate,
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
    const response = await logsApi.getCharacterCompletedLogsApiV1LogsCompletedCharacterIdGet({ characterId })
    return response.data
  },

  // 高度な編纂メカニクスは現在の実装には存在しないため、コメントアウト
  // previewCompilation: async (data: CompletedLogCreate) => {
  //   const response = await logsApi.previewCompilationCostApiV1LogsCompletedPreviewPost({ completedLogCreate: data })
  //   return response.data
  // },

  // purifyLog: async (logId: string, itemIds: string[]) => {
  //   const response = await logsApi.purifyCompletedLogApiV1LogsCompletedLogIdPurifyPost({ logId, requestBody: itemIds })
  //   return response.data
  // },

  // createPurificationItem: async (fragmentIds: string[]) => {
  //   const response = await logsApi.createPurificationItemFromFragmentsApiV1LogsFragmentsCreatePurificationItemPost({ requestBody: fragmentIds })
  //   return response.data
  // },

  // getPurificationItems: async (characterId: string) => {
  //   // この API は現在存在しないようです
  //   throw new Error('Not implemented')
  // },
}