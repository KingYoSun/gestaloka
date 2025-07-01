/**
 * SPシステムの型定義
 */

/**
 * SP取引の種類
 */
export const SPTransactionType = {
  // 取得系
  DAILY_RECOVERY: 'daily_recovery',
  PURCHASE: 'purchase',
  ACHIEVEMENT: 'achievement',
  EVENT_REWARD: 'event_reward',
  LOG_RESULT: 'log_result',
  LOGIN_BONUS: 'login_bonus',
  REFUND: 'refund',
  // 消費系
  FREE_ACTION: 'free_action',
  LOG_DISPATCH: 'log_dispatch',
  LOG_ENHANCEMENT: 'log_enhancement',
  SYSTEM_FUNCTION: 'system_function',
  // システム系
  ADJUSTMENT: 'adjustment',
  MIGRATION: 'migration',
} as const

// eslint-disable-next-line no-redeclare
export type SPTransactionType =
  (typeof SPTransactionType)[keyof typeof SPTransactionType]

/**
 * SP購入パッケージ
 */
export const SPPurchasePackage = {
  SMALL: 'small',
  MEDIUM: 'medium',
  LARGE: 'large',
  EXTRA_LARGE: 'extra_large',
  MEGA: 'mega',
} as const

// eslint-disable-next-line no-redeclare
export type SPPurchasePackage =
  (typeof SPPurchasePackage)[keyof typeof SPPurchasePackage]

/**
 * SP月額パスの種類
 */
export const SPSubscriptionType = {
  BASIC: 'basic',
  PREMIUM: 'premium',
} as const

// eslint-disable-next-line no-redeclare
export type SPSubscriptionType =
  (typeof SPSubscriptionType)[keyof typeof SPSubscriptionType]

/**
 * プレイヤーのSP残高情報
 */
export interface PlayerSP {
  id: string
  userId: string
  currentSp: number
  totalEarnedSp: number
  totalConsumedSp: number
  totalPurchasedSp: number
  totalPurchaseAmount: number
  activeSubscription: SPSubscriptionType | null
  subscriptionExpiresAt: string | null
  consecutiveLoginDays: number
  lastLoginDate: string | null
  createdAt: string
  updatedAt: string
}

/**
 * SP残高の概要（軽量版）
 */
export interface PlayerSPSummary {
  currentSp: number
  activeSubscription: SPSubscriptionType | null
  subscriptionExpiresAt: string | null
}

/**
 * SP取引情報
 */
export interface SPTransaction {
  id: string
  playerSpId: string
  userId: string
  transactionType: SPTransactionType
  amount: number
  balanceBefore: number
  balanceAfter: number
  description: string
  transactionMetadata: Record<string, unknown>
  relatedEntityType: string | null
  relatedEntityId: string | null
  purchasePackage: SPPurchasePackage | null
  purchaseAmount: number | null
  paymentMethod: string | null
  createdAt: string
}

/**
 * SP消費リクエスト
 */
export interface SPConsumeRequest {
  amount: number
  transactionType: SPTransactionType
  description: string
  relatedEntityType?: string
  relatedEntityId?: string
  metadata?: Record<string, unknown>
}

/**
 * SP消費レスポンス
 */
export interface SPConsumeResponse {
  success: boolean
  transactionId: string
  balanceBefore: number
  balanceAfter: number
  message: string
}

/**
 * SP日次回復レスポンス
 */
export interface SPDailyRecoveryResponse {
  success: boolean
  recoveredAmount: number
  loginBonus: number
  consecutiveDays: number
  totalAmount: number
  balanceAfter: number
  message: string
}

/**
 * 取引種別の表示名
 */
export const SPTransactionTypeLabels: Record<SPTransactionType, string> = {
  // 取得系
  [SPTransactionType.DAILY_RECOVERY]: '日次回復',
  [SPTransactionType.PURCHASE]: '購入',
  [SPTransactionType.ACHIEVEMENT]: '実績報酬',
  [SPTransactionType.EVENT_REWARD]: 'イベント報酬',
  [SPTransactionType.LOG_RESULT]: 'ログ成果報酬',
  [SPTransactionType.LOGIN_BONUS]: 'ログインボーナス',
  [SPTransactionType.REFUND]: '返金',
  // 消費系
  [SPTransactionType.FREE_ACTION]: '自由行動',
  [SPTransactionType.LOG_DISPATCH]: 'ログ派遣',
  [SPTransactionType.LOG_ENHANCEMENT]: 'ログ強化',
  [SPTransactionType.SYSTEM_FUNCTION]: 'システム機能',
  // システム系
  [SPTransactionType.ADJUSTMENT]: 'システム調整',
  [SPTransactionType.MIGRATION]: 'データ移行',
}

/**
 * 購入パッケージの情報
 */
export const SPPurchasePackageInfo: Record<
  SPPurchasePackage,
  { sp: number; price: number; label: string }
> = {
  [SPPurchasePackage.SMALL]: { sp: 100, price: 500, label: '100 SP' },
  [SPPurchasePackage.MEDIUM]: { sp: 300, price: 1200, label: '300 SP' },
  [SPPurchasePackage.LARGE]: { sp: 500, price: 2000, label: '500 SP' },
  [SPPurchasePackage.EXTRA_LARGE]: { sp: 1000, price: 3500, label: '1,000 SP' },
  [SPPurchasePackage.MEGA]: { sp: 3000, price: 8000, label: '3,000 SP' },
}

/**
 * サブスクリプションの情報
 */
export const SPSubscriptionInfo: Record<
  SPSubscriptionType,
  { dailyBonus: number; discountRate: number; price: number; label: string }
> = {
  [SPSubscriptionType.BASIC]: {
    dailyBonus: 20,
    discountRate: 0.1,
    price: 1000,
    label: 'ベーシックパス',
  },
  [SPSubscriptionType.PREMIUM]: {
    dailyBonus: 50,
    discountRate: 0.2,
    price: 2500,
    label: 'プレミアムパス',
  },
}
