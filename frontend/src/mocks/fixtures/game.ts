import type { NarrativeResponse, ActionChoice } from '@/api/generated/models'

export const mockActionChoices: ActionChoice[] = [
  {
    text: '剣を抜いて戦う',
    action_type: 'attack',
    description: 'STRチェック（難易度12）',
  },
  {
    text: '交渉を試みる',
    action_type: 'negotiate',
    description: 'CHAチェック（難易度10）',
  },
  {
    text: '逃げる',
    action_type: 'flee',
    description: 'DEXチェック（難易度8）',
  },
]

export const mockNarrativeResponse: NarrativeResponse = {
  narrative: '薄暗い洞窟の奥から、不気味な唸り声が聞こえてきた。松明の光に照らされたのは、赤く光る二つの目。巨大な影があなたに向かってゆっくりと近づいてくる。',
  action_choices: mockActionChoices,
  location_changed: false,
}