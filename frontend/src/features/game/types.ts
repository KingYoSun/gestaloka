/**
 * ゲーム関連の型定義
 */

// NPCエンカウンターデータの型定義
export interface NPCEncounterData {
  npc: {
    npc_id: string
    name: string
    title?: string
    npc_type: string
    appearance?: string
    personality_traits: string[]
    skills: string[]
    contamination_level: number
    log_source?: boolean
    original_player?: string
    persistence_level: number
  }
  encounter_type: string
  choices: Array<{
    id: string
    text: string
    description?: string
    difficulty?: string
  }>
}