/**
 * APIクライアント
 */
import {
  User,
  Character,
  CharacterCreationForm,
  GameSession,
  GameSessionCreate,
  GameSessionListResponse,
  GameActionRequest,
  GameActionResponse,
  SessionEndingProposal,
  SessionEndingAcceptResponse,
  SessionEndingRejectResponse,
  SessionResultResponse,
} from '@/types'
import {
  LogFragment,
  LogFragmentCreate,
  CompletedLog,
  CompletedLogCreate,
  CompletedLogRead,
} from '@/types/log'
import {
  PlayerSP,
  PlayerSPSummary,
  SPTransaction,
  SPConsumeRequest,
  SPConsumeResponse,
  SPDailyRecoveryResponse,
} from '@/types/sp'
import { snakeToCamelObject, camelToSnakeObject } from '@/utils/caseConverter'

const API_BASE_URL =
  (import.meta.env?.VITE_API_URL as string) || 'http://localhost:8000'

interface LoginRequest {
  username: string
  password: string
}

interface LoginResponse {
  access_token: string
  token_type: string
  user: User
}

interface RegisterRequest {
  username: string
  email: string
  password: string
  confirm_password: string
}

class ApiClient {
  private baseUrl: string
  private currentUser: User | null = null

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl
  }

  // Cookieベースの認証に移行したため、トークン管理は不要
  setToken(_token: string | null) {
    // 互換性のため残すが、実際には何もしない
    // Cookieはバックエンドが管理
  }

  getToken(): string | null {
    // Cookieから直接取得することはできない（httpOnly）
    // 互換性のためnullを返す
    return null
  }

  setCurrentUser(user: User | null) {
    this.currentUser = user
  }

  getCurrentUserSync(): User | null {
    return this.currentUser
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${endpoint}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include', // Cookieを送信
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `HTTP ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      console.error('API request failed:', error)
      throw error
    }
  }

  private async requestWithTransform<T>(
    endpoint: string,
    options: RequestInit = {},
    data?: unknown
  ): Promise<T> {
    const transformedOptions = data
      ? {
          ...options,
          body: JSON.stringify(camelToSnakeObject(data)),
        }
      : options

    const response = await this.request<T>(endpoint, transformedOptions)
    return snakeToCamelObject<T>(response)
  }

  // 認証関連
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    // FastAPIのOAuth2PasswordRequestFormに合わせてFormDataを使用
    const formData = new FormData()
    formData.append('username', credentials.username)
    formData.append('password', credentials.password)

    const response = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      body: formData,
      credentials: 'include', // Cookieを受信・送信
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || 'ログインに失敗しました')
    }

    const data = await response.json()
    this.setToken(data.access_token)
    return data
  }

  async register(userData: RegisterRequest): Promise<User> {
    const data = await this.request<User>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    })
    return data
  }

  async logout(): Promise<void> {
    try {
      await this.request('/auth/logout', {
        method: 'POST',
      })
    } finally {
      this.setToken(null)
    }
  }

  async getCurrentUser(): Promise<User> {
    return this.request<User>('/auth/me')
  }

  // ユーザー関連
  async getUser(userId: string): Promise<User> {
    return this.request<User>(`/users/${userId}`)
  }

  // キャラクター関連
  async getCharacters(): Promise<Character[]> {
    return this.requestWithTransform<Character[]>('/characters/')
  }

  async getCharacter(characterId: string): Promise<Character> {
    return this.requestWithTransform<Character>(`/characters/${characterId}`)
  }

  async createCharacter(
    characterData: CharacterCreationForm
  ): Promise<Character> {
    return this.requestWithTransform<Character>(
      '/characters/',
      { method: 'POST' },
      characterData
    )
  }

  async updateCharacter(
    characterId: string,
    updates: Partial<CharacterCreationForm>
  ): Promise<Character> {
    return this.requestWithTransform<Character>(
      `/characters/${characterId}`,
      { method: 'PUT' },
      updates
    )
  }

  async deleteCharacter(characterId: string): Promise<void> {
    await this.request(`/characters/${characterId}`, {
      method: 'DELETE',
    })
  }

  async activateCharacter(characterId: string): Promise<Character> {
    return this.requestWithTransform<Character>(
      `/characters/${characterId}/activate`,
      { method: 'POST' }
    )
  }

  // ゲームセッション関連
  async getGameSessions(): Promise<GameSessionListResponse> {
    return this.requestWithTransform<GameSessionListResponse>('/game/sessions')
  }

  async getGameSession(sessionId: string): Promise<GameSession> {
    return this.requestWithTransform<GameSession>(`/game/sessions/${sessionId}`)
  }

  async createGameSession(
    sessionData: GameSessionCreate
  ): Promise<GameSession> {
    return this.requestWithTransform<GameSession>(
      '/game/sessions',
      { method: 'POST' },
      sessionData
    )
  }

  async updateGameSession(
    sessionId: string,
    updates: { currentScene?: string; sessionData?: Record<string, unknown> }
  ): Promise<GameSession> {
    return this.requestWithTransform<GameSession>(
      `/game/sessions/${sessionId}`,
      { method: 'PUT' },
      updates
    )
  }

  async endGameSession(sessionId: string): Promise<GameSession> {
    return this.requestWithTransform<GameSession>(
      `/game/sessions/${sessionId}/end`,
      { method: 'POST' }
    )
  }

  async executeGameAction(
    sessionId: string,
    action: GameActionRequest
  ): Promise<GameActionResponse> {
    return this.requestWithTransform<GameActionResponse>(
      `/game/sessions/${sessionId}/action`,
      { method: 'POST' },
      action
    )
  }

  // セッション終了提案を取得
  async getSessionEndingProposal(
    sessionId: string
  ): Promise<SessionEndingProposal> {
    return this.requestWithTransform<SessionEndingProposal>(
      `/game/sessions/${sessionId}/ending-proposal`
    )
  }

  // セッション終了を承認
  async acceptSessionEnding(
    sessionId: string
  ): Promise<SessionEndingAcceptResponse> {
    return this.requestWithTransform<SessionEndingAcceptResponse>(
      `/game/sessions/${sessionId}/accept-ending`,
      { method: 'POST' }
    )
  }

  // セッション終了を拒否
  async rejectSessionEnding(
    sessionId: string
  ): Promise<SessionEndingRejectResponse> {
    return this.requestWithTransform<SessionEndingRejectResponse>(
      `/game/sessions/${sessionId}/reject-ending`,
      { method: 'POST' }
    )
  }

  // セッションリザルトを取得
  async getSessionResult(sessionId: string): Promise<SessionResultResponse> {
    return this.requestWithTransform<SessionResultResponse>(
      `/game/sessions/${sessionId}/result`
    )
  }

  // ログフラグメント関連
  async createLogFragment(fragment: LogFragmentCreate): Promise<LogFragment> {
    return this.requestWithTransform<LogFragment>(
      '/logs/fragments',
      { method: 'POST' },
      fragment
    )
  }

  async getLogFragments(characterId: string): Promise<LogFragment[]> {
    return this.requestWithTransform<LogFragment[]>(
      `/logs/fragments/${characterId}`
    )
  }

  // 完成ログ関連
  async createCompletedLog(log: CompletedLogCreate): Promise<CompletedLog> {
    return this.requestWithTransform<CompletedLog>(
      '/logs/completed',
      { method: 'POST' },
      log
    )
  }

  async updateCompletedLog(
    logId: string,
    updates: Partial<CompletedLogCreate>
  ): Promise<CompletedLog> {
    return this.requestWithTransform<CompletedLog>(
      `/logs/completed/${logId}`,
      { method: 'PATCH' },
      updates
    )
  }

  async getCompletedLogs(characterId: string): Promise<CompletedLogRead[]> {
    return this.requestWithTransform<CompletedLogRead[]>(
      `/logs/completed/${characterId}`
    )
  }

  // ログ契約関連のメソッドは削除されました

  // SPシステム関連のAPI

  /**
   * SP残高を取得
   */
  getSPBalance(): Promise<PlayerSP> {
    return this.requestWithTransform<PlayerSP>('/sp/balance')
  }

  /**
   * SP残高の概要を取得（軽量版）
   */
  getSPBalanceSummary(): Promise<PlayerSPSummary> {
    return this.requestWithTransform<PlayerSPSummary>('/sp/balance/summary')
  }

  /**
   * SPを消費
   */
  consumeSP(request: SPConsumeRequest): Promise<SPConsumeResponse> {
    return this.requestWithTransform<SPConsumeResponse>(
      '/sp/consume',
      { method: 'POST' },
      request
    )
  }

  /**
   * 日次SP回復処理
   */
  processDailyRecovery(): Promise<SPDailyRecoveryResponse> {
    return this.requestWithTransform<SPDailyRecoveryResponse>(
      '/sp/daily-recovery',
      { method: 'POST' }
    )
  }

  /**
   * SP取引履歴を取得
   */
  getSPTransactions(params?: {
    transactionType?: string
    startDate?: string
    endDate?: string
    relatedEntityType?: string
    relatedEntityId?: string
    limit?: number
    offset?: number
  }): Promise<SPTransaction[]> {
    const query = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query.append(key, String(value))
        }
      })
    }
    const queryString = query.toString()
    const url = `/sp/transactions${queryString ? `?${queryString}` : ''}`
    return this.requestWithTransform<SPTransaction[]>(url)
  }

  /**
   * SP取引詳細を取得
   */
  getSPTransaction(transactionId: string): Promise<SPTransaction> {
    return this.requestWithTransform<SPTransaction>(
      `/sp/transactions/${transactionId}`
    )
  }

  // 汎用HTTPメソッド
  async get<T>(
    endpoint: string,
    options?: { params?: Record<string, unknown> }
  ): Promise<T> {
    let url = endpoint
    if (options?.params) {
      const query = new URLSearchParams()
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query.append(key, String(value))
        }
      })
      const queryString = query.toString()
      url = `${endpoint}${queryString ? `?${queryString}` : ''}`
    }
    return this.requestWithTransform<T>(url)
  }

  async post<T>(
    endpoint: string,
    data?: unknown,
    options?: RequestInit
  ): Promise<T> {
    return this.requestWithTransform<T>(
      endpoint,
      { method: 'POST', ...options },
      data
    )
  }

  async patch<T>(
    endpoint: string,
    data?: unknown,
    options?: RequestInit
  ): Promise<T> {
    return this.requestWithTransform<T>(
      endpoint,
      { method: 'PATCH', ...options },
      data
    )
  }

  async put<T>(
    endpoint: string,
    data?: unknown,
    options?: RequestInit
  ): Promise<T> {
    return this.requestWithTransform<T>(
      endpoint,
      { method: 'PUT', ...options },
      data
    )
  }

  async delete<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.requestWithTransform<T>(endpoint, {
      method: 'DELETE',
      ...options,
    })
  }
}

export const apiClient = new ApiClient()
export type { LoginRequest, LoginResponse, RegisterRequest }
