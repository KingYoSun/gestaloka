import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CharacterListPage } from '../CharacterListPage'
import { renderWithProviders as render } from '@/test/test-utils'
import { mockCharacters, mockCharacter } from '@/mocks/fixtures/character'
import { charactersApi } from '@/lib/api'
import { useCharacterStore } from '@/stores/characterStore'
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
    getUserCharactersApiV1CharactersGet: vi.fn(),
    deleteCharacterApiV1CharactersCharacterIdDelete: vi.fn(),
    activateCharacterApiV1CharactersCharacterIdActivatePost: vi.fn(),
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
        },
      },
    }),
  },
}))

// ゲームセッション関連のモック
vi.mock('@/hooks/useGameSessions', () => ({
  useGameSessions: () => ({
    data: {
      sessions: [],
      total: 0,
    },
    isLoading: false,
    error: null,
  }),
  useCreateGameSession: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

const renderCharacterListPage = () => {
  return render(<CharacterListPage />)
}

describe('CharacterListPage', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()
    // Zustandストアをリセット
    const initialState = useCharacterStore.getState()
    useCharacterStore.setState({
      ...initialState,
      characters: [],
      activeCharacterId: null,
      selectedCharacterId: null,
      isLoading: false,
      error: null,
    }, true)
  })

  describe('キャラクターが存在しない場合', () => {
    it('should show empty state with create button', async () => {
      vi.mocked(charactersApi.getUserCharactersApiV1CharactersGet).mockResolvedValue({
        data: [],
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      })

      renderCharacterListPage()

      await waitFor(() => {
        expect(screen.getByText(/まだキャラクターがいません/i)).toBeInTheDocument()
      })

      expect(screen.getByText(/最初のキャラクターを作成して/i)).toBeInTheDocument()
      
      const createButtons = screen.getAllByRole('button', { name: /キャラクターを作成/i })
      expect(createButtons).toHaveLength(2) // ヘッダーとカード内の両方

      const createLinks = screen.getAllByRole('link', { name: /キャラクターを作成/i })
      expect(createLinks[0]).toHaveAttribute('href', '/character/create')
    })
  })

  describe('キャラクターが存在する場合', () => {
    beforeEach(() => {
      vi.mocked(charactersApi.getUserCharactersApiV1CharactersGet).mockResolvedValue({
        data: mockCharacters,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      })
    })

    it('should display character list', async () => {
      renderCharacterListPage()

      await waitFor(() => {
        expect(screen.getByText('テストキャラクター')).toBeInTheDocument()
      })

      expect(screen.getByText('セカンドキャラクター')).toBeInTheDocument()
      expect(screen.getByText('サードキャラクター')).toBeInTheDocument()

      // ヘッダーの情報
      expect(screen.getByText(/3体のキャラクターが作成されています/i)).toBeInTheDocument()

      // キャラクターカードの要素
      const levelBadges = screen.getAllByText(/Lv\.1/i)
      expect(levelBadges).toHaveLength(3)

      const locationTexts = screen.getAllByText(/開始の村/i)
      expect(locationTexts).toHaveLength(3)
    })

    it('should handle character activation', async () => {
      const activatedCharacter = { ...mockCharacter, id: 'activated-char' }
      vi.mocked(charactersApi.activateCharacterApiV1CharactersCharacterIdActivatePost)
        .mockResolvedValue({
          data: activatedCharacter,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {} as any,
        })

      renderCharacterListPage()

      await waitFor(() => {
        expect(screen.getByText('テストキャラクター')).toBeInTheDocument()
      })

      // 最初のキャラクターの選択ボタンをクリック
      const selectButtons = screen.getAllByRole('button', { name: /選択$/i })
      await user.click(selectButtons[0])

      await waitFor(() => {
        expect(charactersApi.activateCharacterApiV1CharactersCharacterIdActivatePost)
          .toHaveBeenCalledWith({ characterId: 'test-character-id' })
      })
    })

    it('should handle character deactivation', async () => {
      // アクティブなキャラクターがある状態を設定
      const state = useCharacterStore.getState()
      useCharacterStore.setState({
        ...state,
        characters: mockCharacters,
        activeCharacterId: mockCharacter.id,
      }, true)

      renderCharacterListPage()

      await waitFor(() => {
        const characterTexts = screen.getAllByText('テストキャラクター')
        expect(characterTexts.length).toBeGreaterThan(0)
      })

      // 選択中のボタンをクリック
      const activeButton = screen.getByRole('button', { name: /選択中/i })
      await user.click(activeButton)

      await waitFor(() => {
        const state = useCharacterStore.getState()
        expect(state.activeCharacterId).toBeNull()
      })
    })

    it('should handle character deletion', async () => {
      vi.mocked(charactersApi.deleteCharacterApiV1CharactersCharacterIdDelete)
        .mockResolvedValue({
          data: undefined,
          status: 204,
          statusText: 'No Content',
          headers: {},
          config: {} as any,
        })

      // window.confirmをモック
      vi.spyOn(window, 'confirm').mockReturnValue(true)

      renderCharacterListPage()

      await waitFor(() => {
        expect(screen.getByText('テストキャラクター')).toBeInTheDocument()
      })

      // 削除ボタンをクリック（最初のキャラクター）
      const deleteButtons = screen.getAllByRole('button')
      const deleteButton = deleteButtons.find(button => {
        const child = button.querySelector('svg')
        return child && child.classList.contains('lucide-trash2')
      })

      if (deleteButton) {
        await user.click(deleteButton)
      }

      expect(window.confirm).toHaveBeenCalledWith('このキャラクターを削除してもよろしいですか？')

      await waitFor(() => {
        expect(charactersApi.deleteCharacterApiV1CharactersCharacterIdDelete)
          .toHaveBeenCalledWith({ characterId: 'test-character-id' })
      })
    })

    it('should navigate to edit page', async () => {
      renderCharacterListPage()

      await waitFor(() => {
        expect(screen.getByText('テストキャラクター')).toBeInTheDocument()
      })

      // 最初のキャラクターカード内のボタンを取得
      // カードはキャラクター名のリンクを含む要素
      const characterLink = screen.getByRole('link', { name: 'テストキャラクター' })
      const card = characterLink.closest('.group') // CharacterCardのCard要素
      
      if (!card) {
        throw new Error('Character card not found')
      }

      // カード内のボタンを取得
      const buttonsInCard = card.querySelectorAll('button')
      
      // ボタンの順番: 1番目は選択ボタン、2番目は編集ボタン、3番目は削除ボタン
      const editButton = buttonsInCard[1] // 0-indexed, so 1 is the second button
      
      expect(editButton).toBeDefined()
      await user.click(editButton)
      
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith({
          to: '/character/test-character-id/edit'
        })
      })
    })

    it('should show character limit warning when at max', async () => {
      // 5体のキャラクターを作成
      const maxCharacters = Array.from({ length: 5 }, (_, i) => ({
        ...mockCharacter,
        id: `char-${i}`,
        name: `キャラクター${i + 1}`,
      }))

      vi.mocked(charactersApi.getUserCharactersApiV1CharactersGet).mockResolvedValue({
        data: maxCharacters,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      })

      renderCharacterListPage()

      // まずキャラクターが表示されるのを待つ
      await waitFor(() => {
        expect(screen.getByText('キャラクター1')).toBeInTheDocument()
      })

      // 警告メッセージが表示されるのを待つ
      await waitFor(() => {
        expect(screen.getByText(/キャラクターは最大5体まで作成できます/i)).toBeInTheDocument()
      })
    })
  })

  describe('アクティブキャラクター選択時', () => {
    beforeEach(() => {
      vi.mocked(charactersApi.getUserCharactersApiV1CharactersGet).mockResolvedValue({
        data: mockCharacters,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      })

      // アクティブなキャラクターがある状態を設定
      const state = useCharacterStore.getState()
      useCharacterStore.setState({
        ...state,
        characters: mockCharacters,
        activeCharacterId: mockCharacter.id,
      }, true)
    })

    it('should show active character info and start adventure button', async () => {
      renderCharacterListPage()

      // まずキャラクター一覧が表示されるのを待つ
      await waitFor(() => {
        const characterTexts = screen.getAllByText('テストキャラクター')
        expect(characterTexts.length).toBeGreaterThan(0)
      })

      // アクティブキャラクター情報が表示されるのを待つ
      await waitFor(() => {
        expect(screen.getByText(/選択中のキャラクター/i)).toBeInTheDocument()
      })

      // アクティブキャラクターカード内の情報
      const activeCharacterCard = screen.getByText(/選択中のキャラクター/i).closest('[class*="card"]')
      expect(activeCharacterCard).toHaveTextContent('テストキャラクター')
      
      // 冒険開始ボタン
      const adventureButtons = screen.getAllByRole('button', { name: /冒険を始める/i })
      expect(adventureButtons).toHaveLength(2) // ヘッダーとカード内
    })

    it('should show star icon for active character', async () => {
      renderCharacterListPage()

      await waitFor(() => {
        const characterTexts = screen.getAllByText('テストキャラクター')
        expect(characterTexts.length).toBeGreaterThan(0)
      })

      // アクティブキャラクターのカードに星アイコンがあることを確認
      const characterLinks = screen.getAllByRole('link', { name: /テストキャラクター/i })
      const characterLink = characterLinks[0] // 最初のリンク（カード内のリンク）
      const starIcon = characterLink.querySelector('.lucide-star')
      expect(starIcon).toBeInTheDocument()
      expect(starIcon).toHaveClass('fill-current')
    })
  })

  describe('エラーハンドリング', () => {
    it('should show error message when loading fails', async () => {
      const errorMessage = 'ネットワークエラー'
      vi.mocked(charactersApi.getUserCharactersApiV1CharactersGet).mockRejectedValue(
        new Error(errorMessage)
      )

      renderCharacterListPage()

      await waitFor(() => {
        const alert = screen.getByRole('alert')
        expect(alert).toHaveTextContent('キャラクターの読み込みに失敗しました')
        expect(alert).toHaveTextContent(errorMessage)
      })
    })
  })

  describe('ローディング状態', () => {
    it('should show loading state', () => {
      vi.mocked(charactersApi.getUserCharactersApiV1CharactersGet).mockImplementation(
        () => new Promise(() => {}) // 永続的にpending状態
      )

      const { container } = renderCharacterListPage()

      // ローディングスピナーのSVGを確認
      const spinner = container.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
      
      // ローディング状態のコンテナを確認
      expect(container.querySelector('.min-h-screen')).toBeInTheDocument()
    })
  })
})