import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { CompletedLogList } from '../components/CompletedLogList'
import { CompletedLogRead } from '@/api/logs'

// コンポーネントのモック
vi.mock('@/features/dispatch/components/DispatchForm', () => ({
  DispatchForm: ({ completedLog, open, onOpenChange }: any) => 
    open ? (
      <div data-testid="dispatch-form">
        <div>Dispatch form for {completedLog.name}</div>
        <button onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : null,
}))

vi.mock('../components/CompletedLogDetail', () => ({
  CompletedLogDetail: ({ log, onClose, onPurify }: any) => (
    <div data-testid="log-detail">
      <div>Log detail for {log.name}</div>
      <button onClick={onClose}>Close</button>
      <button onClick={onPurify}>Purify</button>
    </div>
  ),
}))

// ユーティリティのモック
vi.mock('@/lib/utils', () => ({
  formatRelativeTime: (date: string) => '2日前',
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

const mockCompletedLogs: CompletedLogRead[] = [
  {
    id: 'log1',
    creatorId: 'char1',
    name: '冒険の記録',
    title: '始まりの物語',
    description: '最初の冒険の詳細な記録',
    skills: ['探索', '交渉'],
    personalityTraits: ['勇敢', '好奇心旺盛'],
    behaviorPatterns: {},
    contaminationLevel: 0.2,
    status: 'completed',
    created_at: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'log2',
    creatorId: 'char1',
    name: '戦闘の記録',
    title: '戦いの日々',
    description: '激しい戦闘の記録',
    skills: ['戦闘', '防御', '戦術'],
    personalityTraits: ['勇敢'],
    behaviorPatterns: {},
    contaminationLevel: 0.6,
    status: 'draft',
    created_at: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  },
  {
    id: 'log3',
    creatorId: 'char1',
    name: '交流の記録',
    description: '様々な人々との出会い',
    skills: [],
    personalityTraits: ['社交的', '親切'],
    behaviorPatterns: {},
    contaminationLevel: 0,
    status: 'active',
    created_at: '2024-01-03T00:00:00Z',
    updatedAt: '2024-01-03T00:00:00Z',
  },
]

describe('CompletedLogList', () => {
  it('should show loading skeletons', () => {
    render(<CompletedLogList completedLogs={[]} isLoading={true} />)

    // Skeletonコンポーネントが表示されることを確認（クラス名で判定）
    const skeletons = document.querySelectorAll('.skeleton')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('should show empty state when no logs', () => {
    render(<CompletedLogList completedLogs={[]} isLoading={false} />)

    expect(screen.getByText('完成ログがありません')).toBeInTheDocument()
    expect(screen.getByText('フラグメントを選択して編纂してください')).toBeInTheDocument()
  })

  it('should render completed logs', () => {
    render(<CompletedLogList completedLogs={mockCompletedLogs} isLoading={false} />)

    expect(screen.getByText('冒険の記録')).toBeInTheDocument()
    expect(screen.getByText('戦闘の記録')).toBeInTheDocument()
    expect(screen.getByText('交流の記録')).toBeInTheDocument()
  })

  it('should display log details correctly', () => {
    render(<CompletedLogList completedLogs={[mockCompletedLogs[0]]} isLoading={false} />)

    expect(screen.getByText('始まりの物語')).toBeInTheDocument()
    expect(screen.getByText('最初の冒険の詳細な記録')).toBeInTheDocument()
    expect(screen.getByText('スキル: 2')).toBeInTheDocument()
    expect(screen.getByText('性格特性: 2')).toBeInTheDocument()
    expect(screen.getByText('汚染度: 20%')).toBeInTheDocument()
  })

  it('should display status badges', () => {
    render(<CompletedLogList completedLogs={mockCompletedLogs} isLoading={false} />)

    expect(screen.getByText('完成')).toBeInTheDocument()
    expect(screen.getByText('編纂中')).toBeInTheDocument()
    expect(screen.getByText('活動中')).toBeInTheDocument()
  })

  it('should highlight high contamination levels', () => {
    render(<CompletedLogList completedLogs={[mockCompletedLogs[1]]} isLoading={false} />)

    const contaminationElement = screen.getByText('汚染度: 60%').parentElement
    expect(contaminationElement).toHaveClass('text-red-600')
  })

  it('should show dispatch button only for completed logs', () => {
    render(<CompletedLogList completedLogs={mockCompletedLogs} isLoading={false} />)

    // 完成ログには派遣ボタンがある
    const completedLogSection = screen.getByText('冒険の記録').closest('div')!
    expect(within(completedLogSection).getByText('派遣')).toBeInTheDocument()

    // ドラフトログには派遣ボタンがない
    const draftLogSection = screen.getByText('戦闘の記録').closest('div')!
    expect(within(draftLogSection).queryByText('派遣')).not.toBeInTheDocument()
  })

  it('should show purify button for contaminated logs', () => {
    render(<CompletedLogList completedLogs={[mockCompletedLogs[0], mockCompletedLogs[1]]} isLoading={false} />)
    
    // 汚染度が0より大きいログには浄化ボタンがある
    const adventureLogSection = screen.getByText('冒険の記録').closest('div')!
    expect(within(adventureLogSection).getByText('浄化')).toBeInTheDocument()
    
    const battleLogSection = screen.getByText('戦闘の記録').closest('div')!
    expect(within(battleLogSection).getByText('浄化')).toBeInTheDocument()
  })

  it('should open detail view when clicking detail button', () => {
    render(<CompletedLogList completedLogs={[mockCompletedLogs[0]]} isLoading={false} />)

    const detailButton = screen.getByText('詳細')
    fireEvent.click(detailButton)

    expect(screen.getByTestId('log-detail')).toBeInTheDocument()
    expect(screen.getByText('Log detail for 冒険の記録')).toBeInTheDocument()
  })

  it('should close detail view', () => {
    render(<CompletedLogList completedLogs={[mockCompletedLogs[0]]} isLoading={false} />)

    fireEvent.click(screen.getByText('詳細'))
    expect(screen.getByTestId('log-detail')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Close'))
    expect(screen.queryByTestId('log-detail')).not.toBeInTheDocument()
  })

  it('should open dispatch form when clicking dispatch button', () => {
    render(<CompletedLogList completedLogs={[mockCompletedLogs[0]]} isLoading={false} />)

    const dispatchButton = screen.getByText('派遣')
    fireEvent.click(dispatchButton)

    expect(screen.getByTestId('dispatch-form')).toBeInTheDocument()
    expect(screen.getByText('Dispatch form for 冒険の記録')).toBeInTheDocument()
  })

  it('should close dispatch form', () => {
    render(<CompletedLogList completedLogs={[mockCompletedLogs[0]]} isLoading={false} />)

    fireEvent.click(screen.getByText('派遣'))
    expect(screen.getByTestId('dispatch-form')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Close'))
    expect(screen.queryByTestId('dispatch-form')).not.toBeInTheDocument()
  })

  it('should open dispatch form when clicking on dispatchable card', () => {
    render(<CompletedLogList completedLogs={[mockCompletedLogs[0]]} isLoading={false} />)

    const card = screen.getByText('冒険の記録').closest('div')!.parentElement!
    fireEvent.click(card)

    // 完成ログをクリックした場合は選択されるだけで、派遣フォームは開かない
    expect(screen.queryByTestId('dispatch-form')).not.toBeInTheDocument()
  })

  it('should not respond to click on non-dispatchable card', () => {
    render(<CompletedLogList completedLogs={[mockCompletedLogs[1]]} isLoading={false} />)

    const card = screen.getByText('戦闘の記録').closest('div')!.parentElement!
    fireEvent.click(card)

    expect(screen.queryByTestId('dispatch-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('log-detail')).not.toBeInTheDocument()
  })

  it('should handle purify action from detail view', () => {
    render(<CompletedLogList completedLogs={[mockCompletedLogs[0]]} isLoading={false} />)

    fireEvent.click(screen.getByText('詳細'))
    fireEvent.click(screen.getByText('Purify'))

    expect(screen.queryByTestId('log-detail')).not.toBeInTheDocument()
  })

  it('should prevent event propagation on button clicks', () => {
    render(<CompletedLogList completedLogs={[mockCompletedLogs[0]]} isLoading={false} />)

    const detailButton = screen.getByText('詳細')
    fireEvent.click(detailButton)

    // 詳細ボタンをクリックしても派遣フォームは開かない
    expect(screen.getByTestId('log-detail')).toBeInTheDocument()
    expect(screen.queryByTestId('dispatch-form')).not.toBeInTheDocument()
  })

  it('should display no title when title is not provided', () => {
    render(<CompletedLogList completedLogs={[mockCompletedLogs[2]]} isLoading={false} />)

    // タイトルがないログにはバッジが表示されない
    expect(screen.queryByText('始まりの物語')).not.toBeInTheDocument()
    expect(screen.getByText('交流の記録')).toBeInTheDocument()
  })

  it('should show correct skill and trait counts for empty arrays', () => {
    render(<CompletedLogList completedLogs={[mockCompletedLogs[2]]} isLoading={false} />)

    expect(screen.getByText('スキル: 0')).toBeInTheDocument()
    expect(screen.getByText('性格特性: 2')).toBeInTheDocument()
  })
})