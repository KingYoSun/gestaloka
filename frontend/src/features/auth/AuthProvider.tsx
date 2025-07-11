import { useState, useEffect, ReactNode } from 'react'
import { User } from '@/types'
import { apiClient } from '@/api/client'
import { AuthContext, AuthContextType } from './authContext'

// useAuth hook is exported from ./useAuth.ts to avoid fast refresh issues

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // 初期化時にトークンチェック
  useEffect(() => {
    checkAuthStatus()
  }, [])

  const checkAuthStatus = async () => {
    try {
      // Cookie認証のため、直接APIを呼び出してユーザー情報を取得
      const user = await apiClient.getCurrentUser()
      setUser(user)
      apiClient.setCurrentUser(user)
    } catch (error) {
      // 401エラーの場合は未認証状態（正常な状態）
      if (error instanceof Error && error.message.includes('401')) {
        // 未認証は正常な状態なのでログ出力しない
      } else {
        console.error('Auth check failed:', error)
      }
      apiClient.setCurrentUser(null)
    } finally {
      setIsLoading(false)
    }
  }

  const login = async (username: string, password: string) => {
    try {
      const response = await apiClient.login({ username, password })
      // トークンは apiClient.login 内で自動的に設定される
      setUser(response.user)
      apiClient.setCurrentUser(response.user)
    } catch (error) {
      console.error('Login failed:', error)
      throw error
    }
  }

  const logout = async () => {
    try {
      await apiClient.logout()
    } catch (error) {
      console.error('Logout failed:', error)
    } finally {
      setUser(null)
      apiClient.setCurrentUser(null)
    }
  }

  const value: AuthContextType = {
    user,
    isLoading,
    login,
    logout,
    isAuthenticated: !!user,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
