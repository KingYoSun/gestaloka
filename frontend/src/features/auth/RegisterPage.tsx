import { useState } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiClient } from '@/api/client'

export function RegisterPage() {
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: ''
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  
  const navigate = useNavigate()

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    // パスワード確認
    if (formData.password !== formData.confirmPassword) {
      setError('パスワードが一致しません')
      setIsLoading(false)
      return
    }

    try {
      await apiClient.register({
        username: formData.username,
        email: formData.email,
        password: formData.password,
        confirm_password: formData.confirmPassword
      })
      
      setSuccess(true)
      // 3秒後にログインページへリダイレクト
      setTimeout(() => {
        navigate({ to: '/login' })
      }, 3000)
    } catch (err) {
      console.error('Registration failed:', err)
      setError(err instanceof Error ? err.message : '登録に失敗しました')
    } finally {
      setIsLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/50">
        <div className="w-full max-w-md space-y-8 text-center">
          <div className="text-green-600">
            <h2 className="text-3xl font-bold">登録完了！</h2>
            <p className="text-muted-foreground mt-2">
              アカウントが正常に作成されました。
            </p>
            <p className="text-muted-foreground mt-2">
              ログインページに移動します...
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/50">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold">新規登録</h2>
          <p className="text-muted-foreground mt-2">
            ログバースのアカウントを作成
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium mb-2">
                ユーザー名
              </label>
              <Input
                id="username"
                name="username"
                type="text"
                value={formData.username}
                onChange={handleChange}
                required
                minLength={3}
                maxLength={50}
                placeholder="ユーザー名を入力（3-50文字）"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2">
                メールアドレス
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                required
                placeholder="メールアドレスを入力"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-2">
                パスワード
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                required
                minLength={8}
                placeholder="パスワードを入力（8文字以上）"
              />
              <p className="text-xs text-muted-foreground mt-1">
                大文字・小文字・数字を含む8文字以上
              </p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium mb-2">
                パスワード確認
              </label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={handleChange}
                required
                placeholder="パスワードを再入力"
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded">
              {error}
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? '登録中...' : 'アカウント作成'}
          </Button>
        </form>

        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            既にアカウントをお持ちの方は{' '}
            <Link to="/login" className="text-primary hover:underline">
              ログイン
            </Link>
          </p>
        </div>

        <div className="text-center">
          <Link to="/" className="text-sm text-muted-foreground hover:underline">
            ← ホームに戻る
          </Link>
        </div>
      </div>
    </div>
  )
}