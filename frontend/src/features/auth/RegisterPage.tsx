import { useState } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { Input } from '@/components/ui/input'
import { apiClient } from '@/api/client'
import { userRegisterSchema } from '@/lib/validations/schemas/auth'
import { getPasswordStrength } from '@/lib/validations/validators/password'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { FormError } from '@/components/ui/FormError'
import { containerStyles } from '@/lib/styles'
import { useFormError } from '@/hooks/useFormError'

export function RegisterPage() {
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const { error, isLoading, handleAsync } = useFormError()
  const [success, setSuccess] = useState(false)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [passwordStrength, setPasswordStrength] = useState<ReturnType<typeof getPasswordStrength> | null>(null)

  const navigate = useNavigate()

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }))
    
    // パスワード強度の更新
    if (name === 'password') {
      setPasswordStrength(value ? getPasswordStrength(value) : null)
    }
    
    // エラーのクリア
    if (validationErrors[name]) {
      setValidationErrors({ ...validationErrors, [name]: '' })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setValidationErrors({})

    // Zodバリデーション
    const result = userRegisterSchema.safeParse(formData)
    
    if (!result.success) {
      const errors: Record<string, string> = {}
      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          errors[err.path[0].toString()] = err.message
        }
      })
      setValidationErrors(errors)
      return
    }

    await handleAsync(
      async () => {
        await apiClient.register({
          username: formData.username,
          email: formData.email,
          password: formData.password,
          confirm_password: formData.confirmPassword,
        })

        setSuccess(true)
        // 3秒後にログインページへリダイレクト
        setTimeout(() => {
          navigate({ to: '/login' })
        }, 3000)
      },
      '登録に失敗しました'
    )
  }

  if (success) {
    return (
      <div className={containerStyles.centered}>
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
    <div className={containerStyles.centered}>
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold">新規登録</h2>
          <p className="text-muted-foreground mt-2">
            ゲスタロカのアカウントを作成
          </p>
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
                name="username"
                type="text"
                value={formData.username}
                onChange={handleChange}
                required
                minLength={3}
                maxLength={50}
                placeholder="ユーザー名を入力（3-50文字）"
                className={validationErrors.username ? 'border-red-500' : ''}
              />
              {validationErrors.username && (
                <p className="mt-1 text-sm text-red-600">{validationErrors.username}</p>
              )}
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
                className={validationErrors.email ? 'border-red-500' : ''}
              />
              {validationErrors.email && (
                <p className="mt-1 text-sm text-red-600">{validationErrors.email}</p>
              )}
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
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                required
                minLength={8}
                placeholder="パスワードを入力（8文字以上）"
                className={validationErrors.password ? 'border-red-500' : ''}
              />
              {validationErrors.password && (
                <p className="mt-1 text-sm text-red-600">{validationErrors.password}</p>
              )}
              {passwordStrength && formData.password && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">パスワード強度:</span>
                    <span className={`font-medium ${
                      passwordStrength.label === '弱い' ? 'text-red-600' :
                      passwordStrength.label === '普通' ? 'text-yellow-600' :
                      passwordStrength.label === '強い' ? 'text-green-600' :
                      'text-green-700'
                    }`}>
                      {passwordStrength.label}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full rounded-full bg-gray-200">
                    <div
                      className={`h-full rounded-full transition-all ${
                        passwordStrength.label === '弱い' ? 'bg-red-500' :
                        passwordStrength.label === '普通' ? 'bg-yellow-500' :
                        passwordStrength.label === '強い' ? 'bg-green-500' :
                        'bg-green-600'
                      }`}
                      style={{ width: `${(passwordStrength.score / 8) * 100}%` }}
                    />
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                大文字・小文字・数字を含む8文字以上
              </p>
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium mb-2"
              >
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
                className={validationErrors.confirmPassword ? 'border-red-500' : ''}
              />
              {validationErrors.confirmPassword && (
                <p className="mt-1 text-sm text-red-600">{validationErrors.confirmPassword}</p>
              )}
            </div>
          </div>

          <FormError error={error} />

          <LoadingButton
            type="submit"
            className="w-full"
            isLoading={isLoading}
            loadingText="登録中..."
          >
            アカウント作成
          </LoadingButton>
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
