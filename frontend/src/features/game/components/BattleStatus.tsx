/**
 * 戦闘状態表示コンポーネント
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Heart, Shield, Zap, Swords } from 'lucide-react'

interface Combatant {
  id: string
  name: string
  type: 'player' | 'npc' | 'monster' | 'boss'
  hp: number
  max_hp: number
  mp: number
  max_mp: number
  attack: number
  defense: number
  speed: number
  status_effects: string[]
}

interface BattleData {
  state: string
  turn_count: number
  combatants: Combatant[]
  turn_order: string[]
  current_turn_index: number
  environment?: {
    terrain: string
    weather?: string
    time_of_day?: string
    interactive_objects: string[]
  }
}

interface BattleStatusProps {
  battleData: BattleData
}

export function BattleStatus({ battleData }: BattleStatusProps) {
  const player = battleData.combatants.find(c => c.type === 'player')
  const enemies = battleData.combatants.filter(c => c.type !== 'player')

  if (!player || enemies.length === 0) {
    return null
  }

  const currentTurnId = battleData.turn_order[battleData.current_turn_index]
  const isPlayerTurn = currentTurnId === player.id

  return (
    <Card className="border-destructive">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Swords className="h-5 w-5 text-destructive" />
          {battleData.state === 'finished' ? '戦闘終了' : '戦闘中'}
          <Badge variant="outline" className="ml-auto">
            ターン {battleData.turn_count}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* プレイヤーステータス */}
        <div className={`space-y-2 p-3 rounded-lg ${isPlayerTurn ? 'bg-primary/10 border-2 border-primary' : 'bg-muted'}`}>
          <div className="flex items-center justify-between">
            <span className="font-medium">{player.name}</span>
            {isPlayerTurn && <Badge className="bg-primary">あなたのターン</Badge>}
          </div>
          
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <Heart className="h-4 w-4 text-red-500" />
              <span>HP</span>
              <Progress 
                value={(player.hp / player.max_hp) * 100} 
                className="flex-1 h-2"
              />
              <span className="text-xs font-mono">
                {player.hp}/{player.max_hp}
              </span>
            </div>
            
            <div className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-blue-500" />
              <span>MP</span>
              <Progress 
                value={(player.mp / player.max_mp) * 100} 
                className="flex-1 h-2"
              />
              <span className="text-xs font-mono">
                {player.mp}/{player.max_mp}
              </span>
            </div>
          </div>
          
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span>攻撃: {player.attack}</span>
            <span>防御: {player.defense}</span>
            <span>速度: {player.speed}</span>
          </div>
          
          {player.status_effects.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {player.status_effects.map((effect, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs">
                  {effect}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* 敵ステータス */}
        {enemies.map((enemy) => (
          <div key={enemy.id} className={`space-y-2 p-3 rounded-lg ${!isPlayerTurn && battleData.turn_order[battleData.current_turn_index] === enemy.id ? 'bg-destructive/10 border-2 border-destructive' : 'bg-muted'}`}>
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {enemy.name}
                {enemy.level && ` (Lv.${enemy.level})`}
              </span>
              {!isPlayerTurn && battleData.turn_order[battleData.current_turn_index] === enemy.id && <Badge variant="destructive">敵のターン</Badge>}
            </div>
            
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <Heart className="h-4 w-4 text-red-500" />
                <span>HP</span>
                <Progress 
                  value={(enemy.hp / enemy.max_hp) * 100} 
                  className="flex-1 h-2"
                />
                <span className="text-xs font-mono">
                  {enemy.hp}/{enemy.max_hp}
                </span>
              </div>
            </div>
            
            {enemy.status_effects.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {enemy.status_effects.map((effect, idx) => (
                  <Badge key={idx} variant="secondary" className="text-xs">
                    {effect}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* 環境情報 */}
        {battleData.environment && (
          <div className="text-sm text-muted-foreground space-y-1 border-t pt-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              <span>地形: {battleData.environment.terrain}</span>
            </div>
            {battleData.environment.weather && (
              <div className="text-xs">天候: {battleData.environment.weather}</div>
            )}
            {battleData.environment.time_of_day && (
              <div className="text-xs">時間: {battleData.environment.time_of_day}</div>
            )}
            {battleData.environment.interactive_objects && battleData.environment.interactive_objects.length > 0 && (
              <div className="text-xs">
                利用可能: {battleData.environment.interactive_objects.join(', ')}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}