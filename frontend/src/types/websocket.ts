/**
 * WebSocket関連の型定義
 */

export interface GameMessage {
  id?: string;
  type: 'narrative' | 'action_result' | 'system';
  content?: string;
  action?: string;
  result?: unknown;
  timestamp: string;
}

export interface GameState {
  currentScene?: string;
  playerStatus?: Record<string, unknown>;
  worldState?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GameJoinedData {
  message: string;
  game_session_id: string;
  timestamp: string;
}

export interface GameStartedData {
  type: string;
  game_session_id: string;
  initial_state: GameState;
  timestamp: string;
}

export interface NarrativeUpdateData {
  type: string;
  narrative_type: string;
  narrative: string;
  timestamp: string;
}

export interface ActionResultData {
  type: string;
  user_id: string;
  action: string;
  result: unknown;
  timestamp: string;
}

export interface StateUpdateData {
  type: string;
  update: Partial<GameState>;
  timestamp: string;
}

export interface GameErrorData {
  type: string;
  error_type: string;
  message: string;
  timestamp: string;
}

export interface ChatMessage {
  id?: string;
  user_id: string;
  message: string;
  timestamp: string;
}

export interface NotificationData {
  type: string;
  notification_type?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  message?: string;
  achievement?: {
    name: string;
    description: string;
  };
  from_user?: {
    name: string;
  };
  timestamp: string;
}