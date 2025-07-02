/**
 * SPサブスクリプション関連の型定義
 */

export enum SPSubscriptionType {
  BASIC = "BASIC",
  PREMIUM = "PREMIUM"
}

export enum SubscriptionStatus {
  ACTIVE = "active",
  CANCELLED = "cancelled",
  EXPIRED = "expired",
  PENDING = "pending",
  FAILED = "failed"
}

export interface SubscriptionBenefits {
  subscription_type: SPSubscriptionType;
  name: string;
  price: number;
  daily_bonus: number;
  discount_rate: number;
  features: string[];
}

export interface SPSubscriptionResponse {
  id: string;
  user_id: string;
  subscription_type: SPSubscriptionType;
  status: SubscriptionStatus;
  started_at?: string;
  expires_at?: string;
  cancelled_at?: string;
  stripe_subscription_id?: string;
  stripe_customer_id?: string;
  price: number;
  currency: string;
  auto_renew: boolean;
  next_billing_date?: string;
  trial_end?: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  days_remaining?: number;
  is_trial: boolean;
}

export interface SubscriptionPlansResponse {
  plans: SubscriptionBenefits[];
  current_subscription?: SPSubscriptionResponse;
}

export interface SPSubscriptionCreate {
  subscription_type: SPSubscriptionType;
  auto_renew?: boolean;
  payment_method_id?: string;
  trial_days?: number;
}

export interface SPSubscriptionPurchaseResponse {
  success: boolean;
  subscription_id?: string;
  checkout_url?: string;
  message: string;
  test_mode: boolean;
}

export interface SPSubscriptionCancel {
  reason?: string;
  immediate?: boolean;
}

export interface SPSubscriptionUpdate {
  auto_renew?: boolean;
  payment_method_id?: string;
}

export interface SPSubscriptionListResponse {
  subscriptions: SPSubscriptionResponse[];
  total: number;
  active_count: number;
  cancelled_count: number;
}