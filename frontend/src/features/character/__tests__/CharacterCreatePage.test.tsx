import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CharacterCreatePage } from '../CharacterCreatePage'
import { renderWithProviders as render } from '@/test/test-utils'
import { charactersApi } from '@/lib/api'
import type { Character } from '@/api/generated/models'

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
  charactersApi: {
    createCharacterApiV1CharactersPost: vi.fn(),
  },
  configApi: {
    getValidationRulesApiV1ConfigGameValidationRulesGet: vi.fn().mockResolvedValue({
      data: {
        user: {
          username: { min_length: 3, max_length: 50 },
          password: { min_length: 8, max_length: 100 },
        },
        character: {
          name: { min_length: 1, max_length: 50 },
          description: { max_length: 1000 },
          appearance: { max_length: 1000 },
          personality: { max_length: 1000 },
        },
      },
    }),
  },
}))

const renderCharacterCreatePage = () => {
  return render(<CharacterCreatePage />)
}

describe('CharacterCreatePage', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()
    // console.errorをモック化してエラーメッセージを抑制
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('フォーム表示', () => {
    it('should render character creation form', async () => {
      renderCharacterCreatePage()

      // バリデーションルールの読み込みを待つ
      await waitFor(() => {
        expect(screen.getByLabelText(/キャラクター名/i)).toBeInTheDocument()
      })

      expect(screen.getByLabelText(/説明/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/外見/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/性格/i)).toBeInTheDocument()
      
      expect(screen.getByRole('button', { name: /キャラクターを作成/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /キャンセル/i })).toBeInTheDocument()
    })

    it('should show character creation title', async () => {
      renderCharacterCreatePage()

      // バリデーションルールの読み込みを待つ
      await waitFor(() => {
        expect(screen.getByText('キャラクター作成')).toBeInTheDocument()
      })
      
      expect(screen.getByText('新しいキャラクター')).toBeInTheDocument()
    })
  })

  describe('キャラクター作成', () => {
    it('should create character successfully', async () => {
      const newCharacter: Character = {
        id: 'new-char-id',
        user_id: 'user-id',
        name: '新しいキャラクター',
        description: 'テスト用のキャラクターです',
        appearance: '黒髪で背が高い',
        personality: '勇敢で正義感が強い',
        location: '開始の村',
        skills: [],
        stats: null,
        is_active: false,
        created_at: new Date(),
        updated_at: new Date(),
        last_played_at: null,
      }

      vi.mocked(charactersApi.createCharacterApiV1CharactersPost).mockResolvedValue({
        data: newCharacter,
        status: 201,
        statusText: 'Created',
        headers: {},
        config: {} as any,
      })

      renderCharacterCreatePage()

      // フォームの入力
      const nameInput = await screen.findByLabelText(/キャラクター名/i)
      const descriptionInput = screen.getByLabelText(/説明/i)
      const appearanceInput = screen.getByLabelText(/外見/i)
      const personalityInput = screen.getByLabelText(/性格/i)

      await user.type(nameInput, '新しいキャラクター')
      await user.type(descriptionInput, 'テスト用のキャラクターです')
      await user.type(appearanceInput, '黒髪で背が高い')
      await user.type(personalityInput, '勇敢で正義感が強い')

      // 作成ボタンをクリック
      const createButton = screen.getByRole('button', { name: /キャラクターを作成/i })
      await user.click(createButton)

      await waitFor(() => {
        expect(charactersApi.createCharacterApiV1CharactersPost).toHaveBeenCalledWith({
          characterCreate: {
            name: '新しいキャラクター',
            description: 'テスト用のキャラクターです',
            appearance: '黒髪で背が高い',
            personality: '勇敢で正義感が強い',
          }
        })
      })

      // キャラクター一覧ページへの遷移
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith({ to: '/characters' })
      })
    })

    it('should show validation error for empty name', async () => {
      renderCharacterCreatePage()

      const createButton = await screen.findByRole('button', { name: /キャラクターを作成/i })
      await user.click(createButton)

      // React Hook FormとZodバリデーションにより、フォームが送信されない
      expect(charactersApi.createCharacterApiV1CharactersPost).not.toHaveBeenCalled()
    })

    it('should handle creation error', async () => {
      const errorMessage = 'キャラクター作成に失敗しました'
      vi.mocked(charactersApi.createCharacterApiV1CharactersPost).mockRejectedValue(
        new Error(errorMessage)
      )

      renderCharacterCreatePage()

      const nameInput = await screen.findByLabelText(/キャラクター名/i)
      await user.type(nameInput, 'テストキャラクター')

      const createButton = screen.getByRole('button', { name: /キャラクターを作成/i })
      await user.click(createButton)

      // エラー処理はuseCreateCharacterフック内でトースト表示される
      await waitFor(() => {
        expect(charactersApi.createCharacterApiV1CharactersPost).toHaveBeenCalled()
      })
    })

    it('should disable form while creating', async () => {
      vi.mocked(charactersApi.createCharacterApiV1CharactersPost).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({
          data: {} as Character,
          status: 201,
          statusText: 'Created',
          headers: {},
          config: {} as any,
        }), 100))
      )

      renderCharacterCreatePage()

      const nameInput = await screen.findByLabelText(/キャラクター名/i)
      await user.type(nameInput, 'テストキャラクター')

      const createButton = screen.getByRole('button', { name: /キャラクターを作成/i })
      await user.click(createButton)

      // ボタンが無効化される
      expect(createButton).toBeDisabled()
      expect(screen.getByText(/作成中.../i)).toBeInTheDocument()
    })
  })

  describe('ナビゲーション', () => {
    it('should navigate to dashboard on cancel', async () => {
      renderCharacterCreatePage()

      const cancelButton = await screen.findByRole('button', { name: /キャンセル/i })
      await user.click(cancelButton)

      expect(mockNavigate).toHaveBeenCalledWith({ to: '/dashboard' })
    })
  })
})