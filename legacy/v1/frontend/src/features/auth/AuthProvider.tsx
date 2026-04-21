import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { authApi } from '@/lib/api'
import { AuthContext } from './authContext'
import { User } from '@/api/generated/models'

interface AuthProviderProps {
  children: React.ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const navigate = useNavigate()

  // 現在のユーザー情報を取得
  const fetchCurrentUser = useCallback(async () => {
    try {
      const token = localStorage.getItem('accessToken')
      if (!token) {
        setUser(null)
        return
      }

      const response = await authApi.getCurrentUserInfoApiV1AuthMeGet({})
      setUser(response.data)
    } catch (error) {
      console.error('Failed to fetch current user:', error)
      // トークンが無効な場合はクリア
      localStorage.removeItem('accessToken')
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCurrentUser()
  }, [fetchCurrentUser])

  const login = useCallback(async (username: string, password: string) => {
    try {
      const response = await authApi.loginApiV1AuthLoginPost({
        username,
        password,
      })

      // トークンを保存
      if (response.data.access_token) {
        localStorage.setItem('accessToken', response.data.access_token)
      }

      // ユーザー情報を取得
      await fetchCurrentUser()

      // ダッシュボードへリダイレクト
      navigate({ to: '/dashboard' })
    } catch (error) {
      console.error('Login failed:', error)
      throw error
    }
  }, [fetchCurrentUser, navigate])

  const logout = useCallback(async () => {
    try {
      await authApi.logoutApiV1AuthLogoutPost({})
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      // クライアント側でもクリア
      localStorage.removeItem('accessToken')
      setUser(null)
      navigate({ to: '/login' })
    }
  }, [navigate])

  const value = {
    user,
    isLoading,
    login,
    logout,
    isAuthenticated: !!user,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}