import { dispatchApi } from '@/lib/api'
import type {
  DispatchObjectiveType,
  DispatchCreate,
  DispatchRead,
  DispatchEncounterRead,
  DispatchWithEncounters,
  DispatchReportRead,
} from '@/api/generated/models'
// DispatchStatusを型としてのみインポート
import { DispatchStatus } from '@/api/generated/models'

// 型の再エクスポート（互換性維持）
export type {
  DispatchObjectiveType,
  DispatchCreate,
  DispatchRead,
  DispatchEncounterRead,
  DispatchWithEncounters,
  DispatchReportRead,
}

// DispatchStatusも自動生成された型から再エクスポート
export { DispatchStatus }

export const dispatchApiWrapper = {
  // ログを派遣する
  createDispatch: async (data: DispatchCreate): Promise<DispatchRead> => {
    const response = await dispatchApi.createDispatchApiV1DispatchDispatchPost({
      dispatchCreate: data,
    })
    return response.data
  },

  // 自分の派遣一覧を取得
  getMyDispatches: async (params?: {
    status?: DispatchStatus
    skip?: number
    limit?: number
  }): Promise<DispatchRead[]> => {
    const response = await dispatchApi.getMyDispatchesApiV1DispatchDispatchesGet({
      status: params?.status,
      skip: params?.skip,
      limit: params?.limit,
    })
    return response.data
  },

  // 派遣の詳細情報を取得
  getDispatchDetail: async (dispatchId: string): Promise<DispatchWithEncounters> => {
    const response = await dispatchApi.getDispatchDetailApiV1DispatchDispatchesDispatchIdGet({
      dispatchId,
    })
    return response.data
  },

  // 派遣報告書を取得
  getDispatchReport: async (dispatchId: string): Promise<DispatchReportRead> => {
    const response = await dispatchApi.getDispatchReportApiV1DispatchDispatchesDispatchIdReportGet({
      dispatchId,
    })
    return response.data
  },

  // 派遣を緊急召還する
  recallDispatch: async (dispatchId: string): Promise<{ message: string; recall_cost: number }> => {
    const response = await dispatchApi.recallDispatchApiV1DispatchDispatchesDispatchIdRecallPost({
      dispatchId,
    })
    return response.data
  },
}

// 既存のコードとの互換性のため元の名前でエクスポート
export { dispatchApiWrapper as dispatchApi }
