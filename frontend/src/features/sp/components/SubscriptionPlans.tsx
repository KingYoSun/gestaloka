/**
 * サブスクリプションプラン表示コンポーネント
 */

import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePurchaseSubscription, useSubscriptionPlans } from '../hooks/useSubscription';
import { SPSubscriptionType } from '../types/subscription';
import { formatNumber } from '@/lib/utils';

export const SubscriptionPlans = () => {
  const { data, isLoading, error } = useSubscriptionPlans();
  const purchaseMutation = usePurchaseSubscription();
  const [selectedPlan, setSelectedPlan] = useState<SPSubscriptionType | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  if (isLoading) {
    return (
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-red-500">
        プランの読み込みに失敗しました
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const handlePurchase = (subscriptionType: SPSubscriptionType) => {
    setSelectedPlan(subscriptionType);
    setShowConfirmDialog(true);
  };

  const confirmPurchase = () => {
    if (selectedPlan) {
      purchaseMutation.mutate({
        subscription_type: selectedPlan,
        auto_renew: true,
      });
      setShowConfirmDialog(false);
    }
  };

  const currentSubscription = data.current_subscription;

  return (
    <>
      <div className="space-y-4">
        {currentSubscription && currentSubscription.is_active && (
          <Card className="border-primary">
            <CardHeader>
              <CardTitle>現在のサブスクリプション</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p className="text-lg font-semibold">
                  {currentSubscription.subscription_type === SPSubscriptionType.BASIC
                    ? 'ベーシックパス'
                    : 'プレミアムパス'}
                </p>
                <p className="text-sm text-muted-foreground">
                  残り {currentSubscription.days_remaining} 日
                </p>
                {currentSubscription.auto_renew && (
                  <Badge>自動更新有効</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {data.plans.map((plan) => {
            const isCurrentPlan = currentSubscription?.subscription_type === plan.subscription_type;
            const isPremium = plan.subscription_type === SPSubscriptionType.PREMIUM;

            return (
              <Card
                key={plan.subscription_type}
                className={`relative ${isPremium ? 'border-yellow-500' : ''} ${
                  isCurrentPlan ? 'opacity-75' : ''
                }`}
              >
                {isPremium && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-yellow-500 text-black">おすすめ</Badge>
                  </div>
                )}

                <CardHeader>
                  <CardTitle>{plan.name}</CardTitle>
                  <CardDescription>
                    <span className="text-2xl font-bold">¥{formatNumber(plan.price)}</span>
                    <span className="text-muted-foreground">/月</span>
                  </CardDescription>
                </CardHeader>

                <CardContent>
                  <ul className="space-y-3">
                    <li className="flex items-start">
                      <Check className="mr-2 h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <span>毎日 {plan.daily_bonus} SP ボーナス</span>
                    </li>
                    <li className="flex items-start">
                      <Check className="mr-2 h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <span>SP消費 {Math.round(plan.discount_rate * 100)}% 割引</span>
                    </li>
                    {plan.features.map((feature, index) => (
                      <li key={index} className="flex items-start">
                        <Check className="mr-2 h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>

                <CardFooter>
                  <Button
                    className="w-full"
                    variant={isPremium ? 'default' : 'outline'}
                    disabled={isCurrentPlan || purchaseMutation.isPending}
                    onClick={() => handlePurchase(plan.subscription_type)}
                  >
                    {isCurrentPlan ? '購入済み' : '購入する'}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>サブスクリプションを購入しますか？</DialogTitle>
            <DialogDescription>
              {selectedPlan && (
                <>
                  {selectedPlan === SPSubscriptionType.BASIC
                    ? 'ベーシックパス'
                    : 'プレミアムパス'}
                  を購入します。
                  <br />
                  毎月自動的に更新されます。
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              キャンセル
            </Button>
            <Button onClick={confirmPurchase} disabled={purchaseMutation.isPending}>
              購入する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};