/**
 * 探索エリア一覧コンポーネント
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Search, Sparkles, Zap, AlertTriangle } from 'lucide-react';
import { useExploration } from '@/hooks/useExploration';
import { LoadingState } from '@/components/ui/LoadingState';
import { LoadingButton } from '@/components/ui/LoadingButton';
import { useSPBalance } from '@/hooks/useSP';
import type { ExplorationAreaResponse } from '@/api/generated';

export function ExplorationAreas() {
  const { useExplorationAreas, useExploreArea } = useExploration();
  const { data: areas, isLoading, error } = useExplorationAreas();
  const exploreArea = useExploreArea();
  const { data: spBalance } = useSPBalance();
  
  const [selectedArea, setSelectedArea] = useState<ExplorationAreaResponse | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [explorationResult, setExplorationResult] = useState<any>(null);

  if (isLoading) return <LoadingState message="探索エリアを読み込み中..." />;
  if (error) return <div className="text-destructive">探索エリアの取得に失敗しました</div>;
  if (!areas) return null;

  const handleExploreClick = (area: ExplorationAreaResponse) => {
    setSelectedArea(area);
    setConfirmDialogOpen(true);
  };

  const handleConfirmExplore = async () => {
    if (!selectedArea) return;
    
    try {
      const result = await exploreArea.mutateAsync({ areaId: selectedArea.id });
      setExplorationResult(result);
      setResultDialogOpen(true);
    } finally {
      setConfirmDialogOpen(false);
      setSelectedArea(null);
    }
  };

  const currentSP = spBalance?.currentSp ?? 0;

  if (areas.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">この場所には探索可能なエリアがありません</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-4">
        {areas.map((area) => {
          const canAfford = currentSP >= area.exploration_sp_cost;

          return (
            <Card key={area.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Search className="h-4 w-4" />
                      {area.name}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {area.description}
                    </CardDescription>
                  </div>
                  <Badge variant="outline">難易度 {area.difficulty}/10</Badge>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">最大発見数:</span>
                    <span className="ml-1 font-medium">{area.max_fragments_per_exploration}個</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">レア発見率:</span>
                    <span className="ml-1 font-medium">{area.rare_fragment_chance}%</span>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1">
                      <Sparkles className="h-4 w-4 text-purple-600" />
                      レアフラグメント発見率
                    </span>
                    <span>{area.rare_fragment_chance}%</span>
                  </div>
                  <Progress value={area.rare_fragment_chance} className="h-2" />
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4 text-orange-600" />
                      歪み遭遇率
                    </span>
                    <span>{area.encounter_rate}%</span>
                  </div>
                  <Progress value={area.encounter_rate} className="h-2" />
                </div>
              </CardContent>
              
              <CardFooter className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Zap className="h-4 w-4 text-yellow-600" />
                  <span className="font-medium">{area.exploration_sp_cost} SP</span>
                  {!canAfford && (
                    <span className="text-xs text-destructive ml-1">(SP不足)</span>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => handleExploreClick(area)}
                  disabled={!canAfford}
                >
                  探索する
                  <Search className="h-4 w-4 ml-1" />
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {/* 探索確認ダイアログ */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>探索の確認</DialogTitle>
            <DialogDescription>
              {selectedArea && (
                <>
                  <strong>{selectedArea.name}</strong>を探索しますか？
                  <br />
                  <span className="flex items-center gap-1 mt-2">
                    <Zap className="h-4 w-4 text-yellow-600" />
                    {selectedArea.exploration_sp_cost} SPを消費します
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>
              キャンセル
            </Button>
            <LoadingButton
              onClick={handleConfirmExplore}
              isLoading={exploreArea.isPending}
            >
              探索する
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 探索結果ダイアログ */}
      <Dialog open={resultDialogOpen} onOpenChange={setResultDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>探索結果</DialogTitle>
          </DialogHeader>
          {explorationResult && (
            <div className="space-y-4">
              <div className="prose prose-sm max-w-none">
                <p>{explorationResult.narrative}</p>
              </div>
              
              {explorationResult.fragments_found.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">発見したログフラグメント</h4>
                  <div className="space-y-2">
                    {explorationResult.fragments_found.map((fragment: any, index: number) => (
                      <Card key={index}>
                        <CardContent className="py-3">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-medium">{fragment.keyword}</p>
                              <p className="text-sm text-muted-foreground">{fragment.description}</p>
                            </div>
                            <Badge>{fragment.rarity}</Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="flex items-center justify-between text-sm">
                <span>消費SP: {explorationResult.sp_consumed}</span>
                <span>残りSP: {explorationResult.remaining_sp}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setResultDialogOpen(false)}>
              閉じる
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}