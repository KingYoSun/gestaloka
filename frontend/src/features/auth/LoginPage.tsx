import { useState } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { Input } from '@/components/ui/input'
import { useAuth } from './useAuth'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { FormError } from '@/components/ui/FormError'
import { containerStyles } from '@/lib/styles'
import { useFormError } from '@/hooks/useFormError'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const { error, isLoading, handleAsync } = useFormError()

  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    await handleAsync(async () => {
      await login(username, password)
      navigate({ to: '/dashboard' })
    }, 'ログインに失敗しました。ユーザー名とパスワードを確認してください。')
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

          <LoadingButton
            type="submit"
            className="w-full"
            isLoading={isLoading}
            loadingText="ログイン中..."
          >
            ログイン
          </LoadingButton>
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
