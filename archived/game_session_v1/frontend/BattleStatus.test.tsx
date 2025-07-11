import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BattleStatus } from './BattleStatus'

describe('BattleStatus', () => {
  const mockBattleData = {
    state: 'player_turn',
    turn_count: 3,
    combatants: [
      {
        id: 'player_1',
        name: 'ヒーロー',
        type: 'player' as const,
        hp: 75,
        max_hp: 100,
        mp: 30,
        max_mp: 50,
        attack: 15,
        defense: 10,
        speed: 12,
        status_effects: [],
      },
      {
        id: 'enemy_1',
        name: 'ゴブリン',
        type: 'monster' as const,
        level: 3,
        hp: 25,
        max_hp: 40,
        mp: 0,
        max_mp: 0,
        attack: 8,
        defense: 5,
        speed: 10,
        status_effects: [],
      },
    ],
    turn_order: ['player_1', 'enemy_1'],
    current_turn_index: 0,
    battle_log: [
      {
        turn: 1,
        action: 'ヒーローの攻撃！',
        result: 'ゴブリンに12ダメージ',
      },
      {
        turn: 2,
        action: 'ゴブリンの攻撃！',
        result: 'ヒーローに8ダメージ',
      },
    ],
  }

  it('戦闘状態が表示される', () => {
    render(<BattleStatus battleData={mockBattleData} />)

    // タイトルが表示される
    expect(screen.getByText('戦闘中')).toBeInTheDocument()

    // ターン数が表示される
    expect(screen.getByText('ターン 3')).toBeInTheDocument()
  })

  it('プレイヤーのステータスが表示される', () => {
    render(<BattleStatus battleData={mockBattleData} />)

    const player = mockBattleData.combatants[0]

    // プレイヤー名が表示される
    expect(screen.getByText(player.name)).toBeInTheDocument()

    // HPが表示される
    const hpElements = screen.getAllByText('HP')
    expect(hpElements).toHaveLength(2) // プレイヤーと敵の分
    expect(
      screen.getByText(`${player.hp}/${player.max_hp}`)
    ).toBeInTheDocument()

    // MPが表示される
    expect(screen.getByText('MP')).toBeInTheDocument()
    expect(
      screen.getByText(`${player.mp}/${player.max_mp}`)
    ).toBeInTheDocument()

    // ステータスが表示される
    expect(screen.getByText(`攻撃: ${player.attack}`)).toBeInTheDocument()
    expect(screen.getByText(`防御: ${player.defense}`)).toBeInTheDocument()
    expect(screen.getByText(`速度: ${player.speed}`)).toBeInTheDocument()
  })

  it('敵のステータスが表示される', () => {
    render(<BattleStatus battleData={mockBattleData} />)

    const enemy = mockBattleData.combatants[1]

    // 敵名が表示される（レベルも含む）
    expect(screen.getByText('ゴブリン (Lv.3)')).toBeInTheDocument()

    // HPが表示される
    expect(screen.getByText(`${enemy.hp}/${enemy.max_hp}`)).toBeInTheDocument()
  })

  it('現在のターンが表示される', () => {
    render(<BattleStatus battleData={mockBattleData} />)

    // プレイヤーターンの表示
    expect(screen.getByText('あなたのターン')).toBeInTheDocument()
  })

  it('敵のターンの場合、適切に表示される', () => {
    const enemyTurnData = {
      ...mockBattleData,
      state: 'enemy_turn',
      current_turn_index: 1,
    }

    render(<BattleStatus battleData={enemyTurnData} />)

    // 敵ターンの表示
    expect(screen.getByText('敵のターン')).toBeInTheDocument()
  })

  it('戦闘終了状態が表示される', () => {
    const finishedData = {
      ...mockBattleData,
      state: 'finished',
    }

    render(<BattleStatus battleData={finishedData} />)

    // 戦闘終了の表示
    expect(screen.getByText('戦闘終了')).toBeInTheDocument()
  })

  it('HPバーが正しく表示される', () => {
    render(<BattleStatus battleData={mockBattleData} />)

    const player = mockBattleData.combatants[0]

    // プレイヤーのHPバーをチェック
    const playerHpBar = screen.getAllByRole('progressbar')[0]
    expect(playerHpBar).toHaveAttribute('aria-valuenow', player.hp.toString())
    expect(playerHpBar).toHaveAttribute(
      'aria-valuemax',
      player.max_hp.toString()
    )
  })

  it('状態異常が表示される', () => {
    const dataWithStatusEffects = {
      ...mockBattleData,
      combatants: [
        {
          ...mockBattleData.combatants[0],
          status_effects: ['defending', 'poisoned'],
        },
        mockBattleData.combatants[1],
      ],
    }

    render(<BattleStatus battleData={dataWithStatusEffects} />)

    // 状態異常が表示される
    expect(screen.getByText('defending')).toBeInTheDocument()
    expect(screen.getByText('poisoned')).toBeInTheDocument()
  })

  it('複数の敵が表示される', () => {
    const multipleEnemiesData = {
      ...mockBattleData,
      combatants: [
        mockBattleData.combatants[0],
        mockBattleData.combatants[1],
        {
          id: 'enemy_2',
          name: 'スライム',
          type: 'monster' as const,
          level: 2,
          hp: 20,
          max_hp: 20,
          mp: 0,
          max_mp: 0,
          attack: 5,
          defense: 3,
          speed: 8,
          status_effects: [],
        },
      ],
    }

    render(<BattleStatus battleData={multipleEnemiesData} />)

    // 両方の敵が表示される
    expect(screen.getByText('ゴブリン (Lv.3)')).toBeInTheDocument()
    expect(screen.getByText('スライム (Lv.2)')).toBeInTheDocument()
  })

  it('環境情報が表示される', () => {
    const dataWithEnvironment = {
      ...mockBattleData,
      environment: {
        terrain: '森',
        weather: '雨',
        time_of_day: '夜',
        interactive_objects: ['岩', '木'],
        special_conditions: ['視界不良', '移動困難'],
      },
    }

    render(<BattleStatus battleData={dataWithEnvironment} />)

    // 環境情報が表示される
    expect(screen.getByText('地形: 森')).toBeInTheDocument()
    expect(screen.getByText('天候: 雨')).toBeInTheDocument()
    expect(screen.getByText('時間: 夜')).toBeInTheDocument()
    expect(screen.getByText('利用可能: 岩, 木')).toBeInTheDocument()
  })
})
