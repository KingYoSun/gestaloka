import { http, HttpResponse } from 'msw'
import { mockUser } from '../fixtures/user'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'

export const authHandlers = [
  // ログイン
  http.post(`${API_BASE_URL}/auth/login`, async ({ request }) => {
    const body = await request.json() as { email: string; password: string }
    
    if (body.email === 'test@example.com' && body.password === 'password123') {
      return HttpResponse.json({
        access_token: 'mock-access-token',
        token_type: 'bearer',
      })
    }
    
    return HttpResponse.json(
      { detail: 'Invalid email or password' },
      { status: 401 }
    )
  }),

  // 登録
  http.post(`${API_BASE_URL}/auth/register`, async ({ request }) => {
    const body = await request.json() as { email: string; password: string }
    
    if (body.email === 'existing@example.com') {
      return HttpResponse.json(
        { detail: 'Email already registered' },
        { status: 400 }
      )
    }
    
    return HttpResponse.json(mockUser, { status: 201 })
  }),

  // 現在のユーザー取得
  http.get(`${API_BASE_URL}/users/me`, ({ request }) => {
    const authHeader = request.headers.get('Authorization')
    
    if (authHeader === 'Bearer mock-access-token') {
      return HttpResponse.json(mockUser)
    }
    
    return HttpResponse.json(
      { detail: 'Not authenticated' },
      { status: 401 }
    )
  }),

  // ログアウト
  http.post(`${API_BASE_URL}/auth/logout`, () => {
    return HttpResponse.json({ message: 'Successfully logged out' })
  }),
]