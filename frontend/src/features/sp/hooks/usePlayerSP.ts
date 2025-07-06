import { useSPBalance } from '@/hooks/useSP'

/**
 * プレイヤーのSP情報を取得するフック
 * useSPBalanceのエイリアス
 */
export function usePlayerSP() {
  return useSPBalance()
}
