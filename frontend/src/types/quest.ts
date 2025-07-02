// Quest関連の型定義

export enum QuestStatus {
  PROPOSED = 'PROPOSED',
  ACTIVE = 'ACTIVE',
  PROGRESSING = 'PROGRESSING',
  NEAR_COMPLETION = 'NEAR_COMPLETION',
  COMPLETED = 'COMPLETED',
  ABANDONED = 'ABANDONED',
  FAILED = 'FAILED'
}

export enum QuestOrigin {
  GM_PROPOSED = 'GM_PROPOSED',
  PLAYER_DECLARED = 'PLAYER_DECLARED',
  BEHAVIOR_INFERRED = 'BEHAVIOR_INFERRED',
  NPC_GIVEN = 'NPC_GIVEN',
  WORLD_EVENT = 'WORLD_EVENT'
}

export interface Quest {
  id: string;
  character_id: string;
  session_id?: string;
  title: string;
  description: string;
  status: QuestStatus;
  origin: QuestOrigin;
  progress_percentage: number;
  narrative_completeness: number;
  emotional_satisfaction: number;
  key_events?: string[];
  progress_indicators?: string[];
  emotional_arc?: string;
  involved_entities?: Record<string, any>;
  proposed_at?: string;
  started_at?: string;
  completed_at?: string;
  last_progress_at?: string;
  created_at: string;
  updated_at?: string;
}

export interface QuestProposal {
  title: string;
  description: string;
  origin: QuestOrigin;
  rationale: string;
  key_themes: string[];
}

export interface CreateQuestRequest {
  title: string;
  description: string;
  origin: QuestOrigin;
  session_id?: string;
}

export interface QuestListResponse {
  quests: Quest[];
  total: number;
  limit: number;
  offset: number;
}

// ステータスの表示用マッピング
export const QuestStatusDisplay: Record<QuestStatus, string> = {
  [QuestStatus.PROPOSED]: '提案中',
  [QuestStatus.ACTIVE]: '進行中',
  [QuestStatus.PROGRESSING]: '進展あり',
  [QuestStatus.NEAR_COMPLETION]: '完了間近',
  [QuestStatus.COMPLETED]: '完了',
  [QuestStatus.ABANDONED]: '放棄',
  [QuestStatus.FAILED]: '失敗'
};

// 起源の表示用マッピング
export const QuestOriginDisplay: Record<QuestOrigin, string> = {
  [QuestOrigin.GM_PROPOSED]: 'GMからの提案',
  [QuestOrigin.PLAYER_DECLARED]: 'プレイヤー宣言',
  [QuestOrigin.BEHAVIOR_INFERRED]: '行動から推測',
  [QuestOrigin.NPC_GIVEN]: 'NPCから受領',
  [QuestOrigin.WORLD_EVENT]: '世界イベント'
};