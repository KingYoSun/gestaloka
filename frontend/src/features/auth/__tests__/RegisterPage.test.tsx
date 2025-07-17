import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RegisterPage } from '../RegisterPage'
import { renderWithProviders as render } from '@/test/test-utils'
import { authApi } from '@/lib/api'
import type { AxiosError } from 'axios'

// useNavigateのモック
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Link: ({ children, to }: any) => <a href={to}>{children}</a>,
  }
})

// APIのモック
vi.mock('@/lib/api', () => ({
  authApi: {
    registerApiV1AuthRegisterPost: vi.fn(),
  },
  configApi: {
    getValidationRulesApiV1ConfigGameValidationRulesGet: vi.fn().mockResolvedValue({
      data: {
        user: {
          username: {
            min_length: 3,
            max_length: 50,
            pattern: '^[a-zA-Z0-9_-]+$',
            pattern_description: '英数字、アンダースコア、ハイフンのみ使用可能',
          },
          password: {
            min_length: 8,
            max_length: 100,
            requirements: [
              '大文字を1つ以上含む',
              '小文字を1つ以上含む',
              '数字を1つ以上含む',
            ],
          },
        },
        character: {
          name: {
            min_length: 1,
            max_length: 50,
          },
          description: {
            max_length: 1000,
          },
          appearance: {
            max_length: 1000,
          },
          personality: {
            max_length: 1000,
          },
        },
        game_action: {
          action_text: {
            max_length: 1000,
          },
        },
      },
    }),
  },
}))

const renderRegisterPage = () => {
  return render(<RegisterPage />)
}

describe('RegisterPage', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render register form', async () => {
    renderRegisterPage()

    // バリデーションルールの読み込みを待つ
    expect(await screen.findByLabelText(/ユーザー名/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/メールアドレス/i)).toBeInTheDocument()
    expect(screen.getByLabelText('パスワード')).toBeInTheDocument()
    expect(screen.getByLabelText(/パスワード確認/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /アカウント作成/i })).toBeInTheDocument()
    expect(screen.getByText(/既にアカウントをお持ちの方/i)).toBeInTheDocument()
  })

  it('should handle successful registration', async () => {
    vi.mocked(authApi.registerApiV1AuthRegisterPost).mockResolvedValue({
      data: {
        id: '1',
        username: 'newuser',
        email: 'newuser@example.com',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      status: 201,
      statusText: 'Created',
      headers: {},
      config: {} as any,
    })
    
    renderRegisterPage()

    // バリデーションルールの読み込みを待つ
    const usernameInput = await screen.findByLabelText(/ユーザー名/i)
    const emailInput = screen.getByLabelText(/メールアドレス/i)
    const passwordInput = screen.getByLabelText('パスワード')
    const confirmPasswordInput = screen.getByLabelText(/パスワード確認/i)
    const submitButton = screen.getByRole('button', { name: /アカウント作成/i })

    await user.type(usernameInput, 'newuser')
    await user.type(emailInput, 'newuser@example.com')
    await user.type(passwordInput, 'Password123!')
    await user.type(confirmPasswordInput, 'Password123!')
    await user.click(submitButton)

    await waitFor(() => {
      expect(authApi.registerApiV1AuthRegisterPost).toHaveBeenCalledWith({
        userRegister: {
          username: 'newuser',
          email: 'newuser@example.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
        },
      })
    })

    // 登録成功メッセージの表示確認
    expect(screen.getByText(/登録完了！/i)).toBeInTheDocument()
    expect(screen.getByText(/アカウントが正常に作成されました/i)).toBeInTheDocument()

    // 3秒後にログインページにリダイレクト
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' })
    }, { timeout: 4000 })
  }, 10000)

  it('should not submit form with empty fields', async () => {
    renderRegisterPage()

    // バリデーションルールの読み込みを待つ
    const submitButton = await screen.findByRole('button', { name: /アカウント作成/i })
    await user.click(submitButton)

    // HTML5 required属性により、フォームが送信されない
    expect(authApi.registerApiV1AuthRegisterPost).not.toHaveBeenCalled()
  })

  it.skip('should show validation error for invalid email', async () => {
    // このテストはHTMLのtype="email"バリデーションに依存するため、
    // ブラウザ環境でのみ正しく動作します
    renderRegisterPage()

    // バリデーションルールの読み込みを待つ
    const usernameInput = await screen.findByLabelText(/ユーザー名/i)
    const emailInput = screen.getByLabelText(/メールアドレス/i)
    const passwordInput = screen.getByLabelText('パスワード')
    const confirmPasswordInput = screen.getByLabelText(/パスワード確認/i)
    const submitButton = screen.getByRole('button', { name: /アカウント作成/i })

    await user.type(usernameInput, 'newuser')
    await user.type(emailInput, 'invalid-email')
    await user.type(passwordInput, 'Password123!')
    await user.type(confirmPasswordInput, 'Password123!')
    await user.click(submitButton)

    // HTML5のemail検証により、フォームが送信されない
    expect(authApi.registerApiV1AuthRegisterPost).not.toHaveBeenCalled()
  })

  it('should show error when passwords do not match', async () => {
    renderRegisterPage()

    // バリデーションルールの読み込みを待つ
    const usernameInput = await screen.findByLabelText(/ユーザー名/i)
    const emailInput = screen.getByLabelText(/メールアドレス/i)
    const passwordInput = screen.getByLabelText('パスワード')
    const confirmPasswordInput = screen.getByLabelText(/パスワード確認/i)
    const submitButton = screen.getByRole('button', { name: /アカウント作成/i })

    await user.type(usernameInput, 'newuser')
    await user.type(emailInput, 'newuser@example.com')
    await user.type(passwordInput, 'Password123!')
    await user.type(confirmPasswordInput, 'DifferentPassword123!')
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/パスワードが一致しません/i)).toBeInTheDocument()
    })

    expect(authApi.registerApiV1AuthRegisterPost).not.toHaveBeenCalled()
  })

  it('should show error for weak password', async () => {
    renderRegisterPage()

    // バリデーションルールの読み込みを待つ
    const usernameInput = await screen.findByLabelText(/ユーザー名/i)
    const emailInput = screen.getByLabelText(/メールアドレス/i)
    const passwordInput = screen.getByLabelText('パスワード')
    const confirmPasswordInput = screen.getByLabelText(/パスワード確認/i)
    const submitButton = screen.getByRole('button', { name: /アカウント作成/i })

    await user.type(usernameInput, 'newuser')
    await user.type(emailInput, 'newuser@example.com')
    await user.type(passwordInput, 'password')
    await user.type(confirmPasswordInput, 'password')
    await user.click(submitButton)

    await waitFor(() => {
      // パスワードの要件エラーメッセージを確認
      expect(screen.getByText(/数字を1つ以上含む/i)).toBeInTheDocument()
    })

    expect(authApi.registerApiV1AuthRegisterPost).not.toHaveBeenCalled()
  })

  it('should handle registration error', async () => {
    const error = {
      response: {
        data: {
          detail: 'このメールアドレスは既に登録されています',
        },
      },
    } as AxiosError
    
    vi.mocked(authApi.registerApiV1AuthRegisterPost).mockRejectedValue(error)
    
    renderRegisterPage()

    // バリデーションルールの読み込みを待つ
    const usernameInput = await screen.findByLabelText(/ユーザー名/i)
    const emailInput = screen.getByLabelText(/メールアドレス/i)
    const passwordInput = screen.getByLabelText('パスワード')
    const confirmPasswordInput = screen.getByLabelText(/パスワード確認/i)
    const submitButton = screen.getByRole('button', { name: /アカウント作成/i })

    await user.type(usernameInput, 'existing')
    await user.type(emailInput, 'existing@example.com')
    await user.type(passwordInput, 'Password123!')
    await user.type(confirmPasswordInput, 'Password123!')
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText(/登録に失敗しました/i)).toBeInTheDocument()
    })
  })

  it('should disable form while registering', async () => {
    vi.mocked(authApi.registerApiV1AuthRegisterPost).mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({
        data: {
          id: '1',
          username: 'newuser',
          email: 'newuser@example.com',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        status: 201,
        statusText: 'Created',
        headers: {},
        config: {} as any,
      }), 100))
    )
    
    renderRegisterPage()

    // バリデーションルールの読み込みを待つ
    const usernameInput = await screen.findByLabelText(/ユーザー名/i)
    const emailInput = screen.getByLabelText(/メールアドレス/i)
    const passwordInput = screen.getByLabelText('パスワード')
    const confirmPasswordInput = screen.getByLabelText(/パスワード確認/i)
    const submitButton = screen.getByRole('button', { name: /アカウント作成/i })

    await user.type(usernameInput, 'newuser')
    await user.type(emailInput, 'newuser@example.com')
    await user.type(passwordInput, 'Password123!')
    await user.type(confirmPasswordInput, 'Password123!')
    await user.click(submitButton)

    // ボタンが無効化され、ローディングテキストが表示される
    expect(submitButton).toBeDisabled()
    expect(screen.getByText(/登録中.../i)).toBeInTheDocument()

    // 登録完了後、成功画面が表示される
    await waitFor(() => {
      expect(screen.getByText(/登録完了！/i)).toBeInTheDocument()
    })
  })

  it.skip('should show password strength indicator', async () => {
    renderRegisterPage()

    const passwordInput = screen.getByLabelText('パスワード')

    // 弱いパスワード
    await user.type(passwordInput, 'password')
    expect(screen.getByText(/弱い/i)).toBeInTheDocument()

    // 中程度のパスワード
    await user.clear(passwordInput)
    await user.type(passwordInput, 'Password1')
    expect(screen.getByText(/普通/i)).toBeInTheDocument()

    // 強いパスワード
    await user.clear(passwordInput)
    await user.type(passwordInput, 'Password123!')
    expect(screen.getByText(/強い/i)).toBeInTheDocument()
  })
})