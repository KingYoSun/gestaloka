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
    const data = await this.request<Character[]>('/characters')
    return snakeToCamelObject<Character[]>(data)
  }

  async getCharacter(characterId: string): Promise<Character> {
    const data = await this.request<Character>(`/characters/${characterId}`)
    return snakeToCamelObject<Character>(data)
  }

  async createCharacter(
    characterData: CharacterCreationForm
  ): Promise<Character> {
    const snakeData = camelToSnakeObject(characterData)
    const data = await this.request<Character>('/characters', {
      method: 'POST',
      body: JSON.stringify(snakeData),
    })
    return snakeToCamelObject<Character>(data)
  }

  async updateCharacter(
    characterId: string,
    updates: Partial<CharacterCreationForm>
  ): Promise<Character> {
    const snakeData = camelToSnakeObject(updates)
    const data = await this.request<Character>(`/characters/${characterId}`, {
      method: 'PUT',
      body: JSON.stringify(snakeData),
    })
    return snakeToCamelObject<Character>(data)
  }

  async deleteCharacter(characterId: string): Promise<void> {
    await this.request(`/characters/${characterId}`, {
      method: 'DELETE',
    })
  }

  async activateCharacter(characterId: string): Promise<Character> {
    const data = await this.request<Character>(
      `/characters/${characterId}/activate`,
      {
        method: 'POST',
      }
    )
    return snakeToCamelObject<Character>(data)
  }

  // ゲームセッション関連
  async getGameSessions(): Promise<GameSessionListResponse> {
    const data = await this.request<GameSessionListResponse>('/game/sessions')
    return snakeToCamelObject<GameSessionListResponse>(data)
  }

  async getGameSession(sessionId: string): Promise<GameSession> {
    const data = await this.request<GameSession>(`/game/sessions/${sessionId}`)
    return snakeToCamelObject<GameSession>(data)
  }

  async createGameSession(
    sessionData: GameSessionCreate
  ): Promise<GameSession> {
    const snakeData = camelToSnakeObject(sessionData)
    const data = await this.request<GameSession>('/game/sessions', {
      method: 'POST',
      body: JSON.stringify(snakeData),
    })
    return snakeToCamelObject<GameSession>(data)
  }

  async updateGameSession(
    sessionId: string,
    updates: { currentScene?: string; sessionData?: Record<string, unknown> }
  ): Promise<GameSession> {
    const snakeData = camelToSnakeObject(updates)
    const data = await this.request<GameSession>(
      `/game/sessions/${sessionId}`,
      {
        method: 'PUT',
        body: JSON.stringify(snakeData),
      }
    )
    return snakeToCamelObject<GameSession>(data)
  }

  async endGameSession(sessionId: string): Promise<GameSession> {
    const data = await this.request<GameSession>(
      `/game/sessions/${sessionId}/end`,
      {
        method: 'POST',
      }
    )
    return snakeToCamelObject<GameSession>(data)
  }

  async executeGameAction(
    sessionId: string,
    action: GameActionRequest
  ): Promise<GameActionResponse> {
    const snakeData = camelToSnakeObject(action)
    const data = await this.request<GameActionResponse>(
      `/game/sessions/${sessionId}/action`,
      {
        method: 'POST',
        body: JSON.stringify(snakeData),
      }
    )
    return snakeToCamelObject<GameActionResponse>(data)
  }
}

export const apiClient = new ApiClient()
export type { LoginRequest, LoginResponse, RegisterRequest }
