import { apiClient } from '@/lib/api-client'

export interface DispatchObjectiveType {
  EXPLORE: 'explore'
  INTERACT: 'interact'
  COLLECT: 'collect'
  GUARD: 'guard'
  FREE: 'free'
}

export interface DispatchStatus {
  PREPARING: 'preparing'
  DISPATCHED: 'dispatched'
  RETURNING: 'returning'
  COMPLETED: 'completed'
  RECALLED: 'recalled'
}

export interface DispatchCreate {
  completed_log_id: string
  dispatcher_id: string
  objective_type: keyof DispatchObjectiveType
  objective_detail: string
  initial_location: string
  dispatch_duration_days: number
}

export interface DispatchRead {
  id: string
  completed_log_id: string
  dispatcher_id: string
  objective_type: keyof DispatchObjectiveType
  objective_detail: string
  initial_location: string
  dispatch_duration_days: number
  sp_cost: number
  status: keyof DispatchStatus
  travel_log: Array<Record<string, any>>
  collected_items: Array<Record<string, any>>
  discovered_locations: string[]
  sp_refund_amount: number
  achievement_score: number
  created_at: string
  dispatched_at?: string
  expected_return_at?: string
  actual_return_at?: string
}

export interface DispatchEncounterRead {
  id: string
  dispatch_id: string
  encountered_character_id?: string
  encountered_npc_name?: string
  location: string
  interaction_type: string
  interaction_summary: string
  outcome: string
  relationship_change: number
  items_exchanged: string[]
  occurred_at: string
}

export interface DispatchWithEncounters extends DispatchRead {
  encounters: DispatchEncounterRead[]
}

export interface DispatchReportRead {
  id: string
  dispatch_id: string
  total_distance_traveled: number
  total_encounters: number
  total_items_collected: number
  total_locations_discovered: number
  objective_completion_rate: number
  memorable_moments: Array<Record<string, any>>
  personality_changes: string[]
  new_skills_learned: string[]
  narrative_summary: string
  epilogue?: string
  created_at: string
}

export const dispatchApi = {
  // ログを派遣する
  createDispatch: (data: DispatchCreate) =>
    apiClient.post<DispatchRead>('/dispatch/dispatch', data),

  // 自分の派遣一覧を取得
  getMyDispatches: (params?: {
    status?: keyof DispatchStatus
    skip?: number
    limit?: number
  }) =>
    apiClient.get<DispatchRead[]>('/dispatch/dispatches', { params }),

  // 派遣の詳細情報を取得
  getDispatchDetail: (dispatchId: string) =>
    apiClient.get<DispatchWithEncounters>(`/dispatch/dispatches/${dispatchId}`),

  // 派遣報告書を取得
  getDispatchReport: (dispatchId: string) =>
    apiClient.get<DispatchReportRead>(`/dispatch/dispatches/${dispatchId}/report`),

  // 派遣を緊急召還する
  recallDispatch: (dispatchId: string) =>
    apiClient.post<{ message: string; recall_cost: number }>(
      `/dispatch/dispatches/${dispatchId}/recall`
    ),
}