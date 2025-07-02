import { MemoryCombinationPreview, MemoryInheritanceType } from '@/api/memoryInheritance';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { 
  Sword, 
  Crown, 
  Package, 
  Zap, 
  Coins,
  TrendingUp
} from 'lucide-react';

interface MemoryInheritancePreviewProps {
  preview: MemoryCombinationPreview;
  selectedType: MemoryInheritanceType | null;
  onSelectType: (type: MemoryInheritanceType) => void;
}

const typeIcons: Record<MemoryInheritanceType, React.ReactNode> = {
  [MemoryInheritanceType.SKILL]: <Sword className="w-5 h-5" />,
  [MemoryInheritanceType.TITLE]: <Crown className="w-5 h-5" />,
  [MemoryInheritanceType.ITEM]: <Package className="w-5 h-5" />,
  [MemoryInheritanceType.LOG_ENHANCEMENT]: <Zap className="w-5 h-5" />,
};

const typeLabels: Record<MemoryInheritanceType, string> = {
  [MemoryInheritanceType.SKILL]: 'スキル継承',
  [MemoryInheritanceType.TITLE]: '称号獲得',
  [MemoryInheritanceType.ITEM]: 'アイテム生成',
  [MemoryInheritanceType.LOG_ENHANCEMENT]: 'ログ強化',
};

export function MemoryInheritancePreview({
  preview,
  selectedType,
  onSelectType,
}: MemoryInheritancePreviewProps) {
  return (
    <div className="space-y-4">
      {/* SP消費情報 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">SP消費</span>
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-yellow-500" />
              <span className="font-bold">{preview.total_sp_cost} SP</span>
            </div>
          </div>
          
          {preview.combo_bonus > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">基本コスト</span>
              <span>{preview.base_sp_cost} SP</span>
            </div>
          )}
          
          {preview.combo_bonus > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-green-600">コンボボーナス</span>
              <span className="text-green-600">-{preview.combo_bonus}%</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* メモリーテーマ */}
      {preview.memory_themes.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">記憶のテーマ</p>
          <div className="flex flex-wrap gap-2">
            {preview.memory_themes.map((theme) => (
              <Badge key={theme} variant="secondary">
                {theme}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* 継承タイプ選択 */}
      <div className="space-y-3">
        <p className="text-sm font-medium">継承タイプを選択</p>
        <RadioGroup
          value={selectedType || ''}
          onValueChange={(value: string) => onSelectType(value as MemoryInheritanceType)}
        >
          <div className="space-y-2">
            {preview.possible_types.map((type) => (
              <Label
                key={type}
                htmlFor={type}
                className="flex items-center space-x-2 cursor-pointer"
              >
                <RadioGroupItem value={type} id={type} />
                <Card className="flex-1">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-2">
                      {typeIcons[type]}
                      <span className="font-medium">{typeLabels[type]}</span>
                    </div>
                    {renderTypePreview(type, preview)}
                  </CardContent>
                </Card>
              </Label>
            ))}
          </div>
        </RadioGroup>
      </div>

      {/* レアリティ分布 */}
      {Object.keys(preview.rarity_distribution).length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium mb-3">レアリティ分布</p>
            <div className="space-y-2">
              {Object.entries(preview.rarity_distribution).map(([rarity, count]) => (
                <div key={rarity} className="flex items-center justify-between text-sm">
                  <span>{rarity}</span>
                  <div className="flex items-center gap-2">
                    <Progress
                      value={(count / Object.values(preview.rarity_distribution).reduce((a, b) => a + b, 0)) * 100}
                      className="w-24 h-2"
                    />
                    <span className="text-muted-foreground w-8 text-right">{count}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function renderTypePreview(type: MemoryInheritanceType, preview: MemoryCombinationPreview) {
  switch (type) {
    case MemoryInheritanceType.SKILL:
      if (!preview.skill_preview) return null;
      return (
        <div className="space-y-1 text-sm">
          <p className="font-medium">{preview.skill_preview.name}</p>
          <p className="text-muted-foreground text-xs">{preview.skill_preview.description}</p>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="text-xs">
              {preview.skill_preview.rarity}
            </Badge>
            <span className="text-xs text-muted-foreground">
              威力: {preview.skill_preview.estimated_power}
            </span>
          </div>
        </div>
      );

    case MemoryInheritanceType.TITLE:
      if (!preview.title_preview) return null;
      return (
        <div className="space-y-1 text-sm">
          <p className="font-medium">{preview.title_preview.name}</p>
          <p className="text-muted-foreground text-xs">{preview.title_preview.description}</p>
          {Object.entries(preview.title_preview.stat_bonuses).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {Object.entries(preview.title_preview.stat_bonuses).map(([stat, bonus]) => (
                <Badge key={stat} variant="secondary" className="text-xs">
                  {stat} +{bonus}
                </Badge>
              ))}
            </div>
          )}
        </div>
      );

    case MemoryInheritanceType.ITEM:
      if (!preview.item_preview) return null;
      return (
        <div className="space-y-1 text-sm">
          <p className="font-medium">{preview.item_preview.name}</p>
          <p className="text-muted-foreground text-xs">{preview.item_preview.description}</p>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="text-xs">
              {preview.item_preview.item_type}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {preview.item_preview.rarity}
            </Badge>
          </div>
        </div>
      );

    case MemoryInheritanceType.LOG_ENHANCEMENT:
      if (!preview.log_enhancement_preview) return null;
      return (
        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-500" />
            <span className="text-xs">
              ボーナス倍率: x{preview.log_enhancement_preview.bonus_multiplier}
            </span>
          </div>
          <p className="text-muted-foreground text-xs">
            影響: {preview.log_enhancement_preview.estimated_impact}
          </p>
          {preview.log_enhancement_preview.enhancements.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {preview.log_enhancement_preview.enhancements.slice(0, 3).map((enhancement) => (
                <Badge key={enhancement} variant="secondary" className="text-xs">
                  {enhancement}
                </Badge>
              ))}
            </div>
          )}
        </div>
      );

    default:
      return null;
  }
}