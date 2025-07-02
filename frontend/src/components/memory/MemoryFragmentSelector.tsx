import { LogFragment } from '@/api/generated';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Sparkles, Star } from 'lucide-react';

interface MemoryFragmentSelectorProps {
  fragments: LogFragment[];
  selectedIds: string[];
  onToggleSelection: (fragmentId: string) => void;
}

const rarityColors: Record<string, string> = {
  COMMON: 'bg-gray-500',
  UNCOMMON: 'bg-green-500',
  RARE: 'bg-blue-500',
  EPIC: 'bg-purple-500',
  LEGENDARY: 'bg-orange-500',
  UNIQUE: 'bg-red-500',
  ARCHITECT: 'bg-gradient-to-r from-purple-600 to-pink-600',
};

const rarityTextColors: Record<string, string> = {
  COMMON: 'text-gray-600',
  UNCOMMON: 'text-green-600',
  RARE: 'text-blue-600',
  EPIC: 'text-purple-600',
  LEGENDARY: 'text-orange-600',
  UNIQUE: 'text-red-600',
  ARCHITECT: 'text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600',
};

export function MemoryFragmentSelector({
  fragments,
  selectedIds,
  onToggleSelection,
}: MemoryFragmentSelectorProps) {
  return (
    <ScrollArea className="h-[500px] pr-4">
      <div className="space-y-2">
        {fragments.map((fragment) => {
          const isSelected = selectedIds.includes(fragment.id);
          const isArchitect = fragment.rarity === 'ARCHITECT';
          
          return (
            <Card
              key={fragment.id}
              className={cn(
                "p-4 cursor-pointer transition-all",
                isSelected && "ring-2 ring-primary",
                isArchitect && "border-purple-500"
              )}
              onClick={() => onToggleSelection(fragment.id)}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelection(fragment.id)}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                />
                
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium flex items-center gap-2">
                      {fragment.title}
                      {isArchitect && (
                        <Sparkles className="w-4 h-4 text-purple-500" />
                      )}
                    </h4>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs",
                        rarityTextColors[fragment.rarity]
                      )}
                    >
                      <Star
                        className={cn(
                          "w-3 h-3 mr-1",
                          rarityColors[fragment.rarity]
                        )}
                      />
                      {fragment.rarity}
                    </Badge>
                  </div>
                  
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {fragment.content}
                  </p>
                  
                  {fragment.keywords && fragment.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {fragment.keywords.slice(0, 3).map((keyword: string) => (
                        <Badge key={keyword} variant="secondary" className="text-xs">
                          {keyword}
                        </Badge>
                      ))}
                      {fragment.keywords.length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{fragment.keywords.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </ScrollArea>
  );
}