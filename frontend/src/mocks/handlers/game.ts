import { http, HttpResponse, delay } from 'msw'
import { mockNarrativeResponse } from '../fixtures/game'
import type { ActionRequest } from '@/api/generated/models'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export const gameHandlers = [
  // ゲームセッション開始
  http.post(`${API_BASE_URL}/api/v1/narrative/start`, async ({ request }) => {
    const body = await request.json() as { character_id: string }
    
    // 遅延を追加してリアルな動作を再現
    await delay(500)
    
    return HttpResponse.json({
      ...mockNarrativeResponse,
      session_id: `session-${Date.now()}`,
    })
  }),

  // アクション実行
  http.post(`${API_BASE_URL}/api/v1/narrative/action`, async ({ request }) => {
    const body = await request.json() as ActionRequest
    
    // 遅延を追加してリアルな動作を再現
    await delay(1000)
    
    // アクションに応じて異なるナラティブを返す
    const narratives = {
      'action-1': '剣を抜いたあなたは、勇敢に影に立ち向かった。激しい戦いの末、あなたは勝利を収めた。',
      'action-2': 'あなたは冷静に話しかけた。影は徐々に形を変え、一人の老人の姿となった。',
      'action-3': 'あなたは素早く洞窟から逃げ出した。背後から追いかけてくる気配はない。',
    }
    
    const selectedNarrative = narratives[body.action_id as keyof typeof narratives] || 'あなたは行動を選択した。'
    
    return HttpResponse.json({
      ...mockNarrativeResponse,
      narrative: selectedNarrative,
      session_id: body.session_id,
    })
  }),

  // セッション終了
  http.post(`${API_BASE_URL}/api/v1/narrative/end`, async ({ request }) => {
    const body = await request.json() as { session_id: string }
    
    return HttpResponse.json({
      message: 'Session ended successfully',
      session_id: body.session_id,
    })
  }),

  // ゲーム設定取得
  http.get(`${API_BASE_URL}/api/v1/config/game`, () => {
    return HttpResponse.json({
      game_mechanics: {
        sp_daily_recovery: 10,
        sp_max_limit: 1000,
        log_fragment_drop_rate: 0.1,
      },
      validation_rules: {
        character_name_min_length: 2,
        character_name_max_length: 20,
        password_min_length: 8,
      },
    })
  }),
]