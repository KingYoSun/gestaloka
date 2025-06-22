/**
 * 現在地情報コンポーネント
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Shield, Store, Hotel, Users } from 'lucide-react';
import { useExploration } from '@/hooks/useExploration';
import { LoadingState } from '@/components/ui/LoadingState';
import type { DangerLevel, LocationType } from '@/api/generated';

const locationTypeLabels: Record<LocationType, string> = {
  city: '都市',
  town: '町',
  dungeon: 'ダンジョン',
  wild: '荒野',
  special: '特殊',
};

const dangerLevelConfig: Record<DangerLevel, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  safe: { label: '安全', variant: 'default' },
  low: { label: '低危険度', variant: 'secondary' },
  medium: { label: '中危険度', variant: 'secondary' },
  high: { label: '高危険度', variant: 'destructive' },
  extreme: { label: '極度の危険', variant: 'destructive' },
};

export function CurrentLocationInfo() {
  const { useCurrentLocation } = useExploration();
  const { data: location, isLoading, error } = useCurrentLocation();

  if (isLoading) return <LoadingState message="現在地情報を読み込み中..." />;
  if (error) return <div className="text-destructive">現在地情報の取得に失敗しました</div>;
  if (!location) return null;

  const dangerConfig = dangerLevelConfig[location.danger_level];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          {location.name}
        </CardTitle>
        <CardDescription>{location.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 基本情報 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">タイプ</span>
            <Badge variant="outline">{locationTypeLabels[location.location_type]}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">階層レベル</span>
            <span className="font-medium">{location.hierarchy_level}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">危険度</span>
            <Badge variant={dangerConfig.variant}>
              <Shield className="h-3 w-3 mr-1" />
              {dangerConfig.label}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">フラグメント発見率</span>
            <span className="font-medium">{location.fragment_discovery_rate}%</span>
          </div>
        </div>

        {/* 施設情報 */}
        <div>
          <h4 className="text-sm font-medium mb-2">利用可能な施設</h4>
          <div className="flex gap-2">
            {location.has_inn && (
              <Badge variant="secondary">
                <Hotel className="h-3 w-3 mr-1" />
                宿屋
              </Badge>
            )}
            {location.has_shop && (
              <Badge variant="secondary">
                <Store className="h-3 w-3 mr-1" />
                商店
              </Badge>
            )}
            {location.has_guild && (
              <Badge variant="secondary">
                <Users className="h-3 w-3 mr-1" />
                ギルド
              </Badge>
            )}
            {!location.has_inn && !location.has_shop && !location.has_guild && (
              <span className="text-sm text-muted-foreground">なし</span>
            )}
          </div>
        </div>

        {/* 座標 */}
        <div className="text-xs text-muted-foreground">
          座標: ({location.x_coordinate}, {location.y_coordinate})
        </div>
      </CardContent>
    </Card>
  );
}