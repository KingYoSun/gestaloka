import type { NarrativeResponse, ActionChoice } from '@/api/generated/models'

export const mockActionChoices: ActionChoice[] = [
  {
    action_id: 'action-1',
    description: '剣を抜いて戦う',
    effects: 'STRチェック（難易度12）',
  },
  {
    action_id: 'action-2',
    description: '交渉を試みる',
    effects: 'CHAチェック（難易度10）',
  },
  {
    action_id: 'action-3',
    description: '逃げる',
    effects: 'DEXチェック（難易度8）',
  },
]

export const mockNarrativeResponse: NarrativeResponse = {
  narrative: '薄暗い洞窟の奥から、不気味な唸り声が聞こえてきた。松明の光に照らされたのは、赤く光る二つの目。巨大な影があなたに向かってゆっくりと近づいてくる。',
  actions: mockActionChoices,
  session_id: 'test-session-id',
  is_session_complete: false,
  location: '薄暗い洞窟',
  timestamp: '2025-07-17T12:00:00Z',
}