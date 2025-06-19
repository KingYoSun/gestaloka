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
} from '@/types'
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
  private token: string | null = null

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl
    this.token = localStorage.getItem('authToken')
  }

  setToken(token: string | null) {
    this.token = token
    if (token) {
      localStorage.setItem('authToken', token)
    } else {
      localStorage.removeItem('authToken')
    }
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

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
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
    return this.requestWithTransform<Character[]>('/characters')
  }

  async getCharacter(characterId: string): Promise<Character> {
    return this.requestWithTransform<Character>(`/characters/${characterId}`)
  }

  async createCharacter(
    characterData: CharacterCreationForm
  ): Promise<Character> {
    return this.requestWithTransform<Character>(
      '/characters',
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
}

export const apiClient = new ApiClient()
export type { LoginRequest, LoginResponse, RegisterRequest }
