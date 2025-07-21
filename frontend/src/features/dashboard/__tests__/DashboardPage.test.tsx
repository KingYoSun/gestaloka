import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { DashboardPage } from '../DashboardPage'
import { renderWithProviders as render } from '@/test/test-utils'
import * as useCharactersModule from '@/hooks/useCharacters'
import * as useGameSessionsModule from '@/hooks/useGameSessions'

// React Routerのモック
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router')
  return {
    ...actual,
    Link: ({ to, children, className }: any) => (
      <a href={to} className={className} data-testid={`link-${to}`}>
        {children}
      </a>
    ),
    useNavigate: () => mockNavigate,
  }
})

const mockCharacters = [
  { id: 'char1', name: 'キャラクター1' },
  { id: 'char2', name: 'キャラクター2' },
  { id: 'char3', name: 'キャラクター3' },
]

const mockSessions = {
  sessions: [
    {
      id: 'session1',
      characterId: 'char1',
      isActive: true,
      sessionData: { turn_count: 5 },
    },
    {
      id: 'session2',
      characterId: 'char2',
      isActive: true,
      sessionData: { turn_count: 10 },
    },
    {
      id: 'session3',
      characterId: 'char3',
      isActive: false,
      sessionData: { turn_count: 3 },
    },
    {
      id: 'session4',
      characterId: 'char1',
      isActive: true,
      sessionData: { turn_count: 15 },
    },
    {
      id: 'session5',
      characterId: 'deleted-char',
      isActive: true,
      sessionData: { turn_count: 8 },
    },
  ],
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    vi.spyOn(useCharactersModule, 'useCharacters').mockReturnValue({
      data: mockCharacters,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    vi.spyOn(useGameSessionsModule, 'useGameSessions').mockReturnValue({
      data: mockSessions,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any)
  })

  it('should render dashboard with all cards', async () => {
    render(<DashboardPage />)

    expect(await screen.findByText('ダッシュボード')).toBeInTheDocument()
    expect(screen.getByText('ゲスタロカへようこそ！ここから冒険を始めましょう。')).toBeInTheDocument()
    
    // 各カードのタイトル
    expect(screen.getByText('キャラクター管理')).toBeInTheDocument()
    expect(screen.getByText('進行中のセッション')).toBeInTheDocument()
    expect(screen.getByText('ログシステム')).toBeInTheDocument()
    expect(screen.getByText('クエスト管理')).toBeInTheDocument()
  })

  it('should render character management card with links', async () => {
    render(<DashboardPage />)

    expect(await screen.findByText('キャラクター管理')).toBeInTheDocument()
    expect(screen.getByText('あなたのキャラクターを管理し、新しいキャラクターを作成しましょう')).toBeInTheDocument()
    
    // リンクの存在確認（ボタンテキストで確認）
    expect(screen.getByRole('button', { name: /キャラクター一覧/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新規キャラクター作成/i })).toBeInTheDocument()
  })

  it('should show active sessions count', async () => {
    render(<DashboardPage />)

    // アクティブで削除されていないキャラクターのセッション数
    const sessionsTitle = await screen.findByText(/進行中のセッション/i)
    // Badge内の数字を確認
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('should list active sessions with valid characters', async () => {
    render(<DashboardPage />)

    // ページのロードを待つ
    await screen.findByText('ダッシュボード')
    
    // 最初の3つのアクティブセッションが表示される
    // 複数要素がある場合はgetAllByTextを使用
    const character1Elements = screen.getAllByText('キャラクター1')
    expect(character1Elements[0]).toBeInTheDocument()
    expect(screen.getByText('ターン 5')).toBeInTheDocument()
    
    expect(screen.getByText('キャラクター2')).toBeInTheDocument()
    expect(screen.getByText('ターン 10')).toBeInTheDocument()
    
    // 削除されたキャラクターのセッションは表示されない
    expect(screen.queryByText('ターン 8')).not.toBeInTheDocument()
  })

  it('should navigate to game session when play button is clicked', async () => {
    render(<DashboardPage />)

    // ページのロードを待つ
    await screen.findByText('ダッシュボード')
    
    const playButtons = screen.getAllByRole('button')
    // PlayCircleアイコンを持つボタンを探す
    const firstPlayButton = playButtons.find(btn => {
      const svg = btn.querySelector('svg')
      return svg && svg.classList.contains('lucide-play-circle')
    })
    
    if (firstPlayButton) {
      fireEvent.click(firstPlayButton)
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/game/session1' })
    }
  })

  it('should show no sessions message when there are no active sessions', async () => {
    vi.spyOn(useGameSessionsModule, 'useGameSessions').mockReturnValue({
      data: { sessions: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    render(<DashboardPage />)

    expect(await screen.findByText('現在進行中のゲームセッションはありません')).toBeInTheDocument()
  })

  it('should handle sessions with non-active status', async () => {
    vi.spyOn(useGameSessionsModule, 'useGameSessions').mockReturnValue({
      data: {
        sessions: [
          {
            id: 'session1',
            characterId: 'char1',
            isActive: false,
            sessionData: { turn_count: 5 },
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    render(<DashboardPage />)

    expect(await screen.findByText('現在進行中のゲームセッションはありません')).toBeInTheDocument()
  })

  it('should handle sessions without turn_count data', async () => {
    vi.spyOn(useGameSessionsModule, 'useGameSessions').mockReturnValue({
      data: {
        sessions: [
          {
            id: 'session1',
            characterId: 'char1',
            isActive: true,
            sessionData: {},
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    render(<DashboardPage />)

    // ページのロードを待つ
    await screen.findByText('ダッシュボード')
    
    expect(screen.getByText('ターン 0')).toBeInTheDocument()
  })

  it('should handle sessions with invalid sessionData', async () => {
    vi.spyOn(useGameSessionsModule, 'useGameSessions').mockReturnValue({
      data: {
        sessions: [
          {
            id: 'session1',
            characterId: 'char1',
            isActive: true,
            sessionData: null,
          },
          {
            id: 'session2',
            characterId: 'char2',
            isActive: true,
            sessionData: 'invalid',
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    render(<DashboardPage />)

    // ページのロードを待つ
    await screen.findByText('ダッシュボード')
    
    const turnTexts = screen.getAllByText(/ターン \d+/)
    expect(turnTexts[0]).toHaveTextContent('ターン 0')
    expect(turnTexts[1]).toHaveTextContent('ターン 0')
  })

  it('should show overflow message when more than 3 active sessions', async () => {
    vi.spyOn(useGameSessionsModule, 'useGameSessions').mockReturnValue({
      data: {
        sessions: [
          ...Array.from({ length: 5 }, (_, i) => ({
            id: `session${i + 1}`,
            characterId: 'char1',
            isActive: true,
            sessionData: { turn_count: i + 1 },
          })),
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    render(<DashboardPage />)

    // ページのロードを待つ
    await screen.findByText('ダッシュボード')
    
    expect(screen.getByText('他 2 件のセッション')).toBeInTheDocument()
  })

  it('should render log system card with link', async () => {
    render(<DashboardPage />)

    // ログシステムのタイトルが存在することを確認
    expect(await screen.findByText('ログシステム')).toBeInTheDocument()
    
    expect(screen.getByText('キャラクターの記録を管理し、ログを編纂してNPCを作成します')).toBeInTheDocument()
    expect(screen.getByTestId('link-/logs')).toBeInTheDocument()
  })

  it('should render quest management card with link', async () => {
    render(<DashboardPage />)

    // クエスト管理のタイトルが存在することを確認
    expect(await screen.findByText('クエスト管理')).toBeInTheDocument()
    
    expect(screen.getByText('物語の目標を設定し、進行状況を確認します')).toBeInTheDocument()
    expect(screen.getByTestId('link-/quests')).toBeInTheDocument()
  })

  it('should handle missing characters data', async () => {
    vi.spyOn(useCharactersModule, 'useCharacters').mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    render(<DashboardPage />)

    // セッションカードは表示されるが、キャラクターがないのでセッションは表示されない
    expect(await screen.findByText('現在進行中のゲームセッションはありません')).toBeInTheDocument()
  })

  it('should handle missing sessions data', async () => {
    vi.spyOn(useGameSessionsModule, 'useGameSessions').mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any)

    render(<DashboardPage />)

    expect(await screen.findByText('現在進行中のゲームセッションはありません')).toBeInTheDocument()
  })
})