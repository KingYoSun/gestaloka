import { useState } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { Input } from '@/components/ui/input'
import { useAuth } from './useAuth'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { FormError } from '@/components/ui/FormError'
import { containerStyles } from '@/lib/styles'
import { Route } from '@/routes/login'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const { login } = useAuth()
  const navigate = useNavigate()
  const search = Route.useSearch()
  const redirect = search.redirect || '/dashboard'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    setIsLoading(true)
    setError(null)
    
    try {
      await login(username, password)
      // リダイレクト先またはダッシュボードへ遷移
      navigate({ to: redirect })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました。ユーザー名とパスワードを確認してください。')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={containerStyles.centered}>
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold">ログイン</h2>
          <p className="text-muted-foreground mt-2">ゲスタロカへようこそ</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium mb-2"
              >
                ユーザー名
              </label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                placeholder="ユーザー名を入力"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium mb-2"
              >
                パスワード
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="パスワードを入力"
              />
            </div>
          </div>

          <FormError error={error} />

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <LoadingSpinner size="sm" className="mr-2" />
                ログイン中...
              </>
            ) : (
              'ログイン'
            )}
          </Button>
        </form>

        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            アカウントをお持ちでない方は{' '}
            <Link to="/register" className="text-primary hover:underline">
              新規登録
            </Link>
          </p>
        </div>

        <div className="text-center">
          <Link
            to="/"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← ホームに戻る
          </Link>
        </div>
      </div>
    </div>
  )
}
