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
import { motion, AnimatePresence } from 'framer-motion';
import type { ExplorationAreaResponse } from '@/api/generated';
import { FragmentDiscoveryAnimation } from './FragmentDiscoveryAnimation';

export function ExplorationAreas() {
  const { useExplorationAreas, useExploreArea } = useExploration();
  const { data: areas, isLoading, error } = useExplorationAreas();
  const exploreArea = useExploreArea();
  const { data: spBalance } = useSPBalance();
  
  const [selectedArea, setSelectedArea] = useState<ExplorationAreaResponse | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [explorationResult, setExplorationResult] = useState<any>(null);
  const [showDiscoveryAnimation, setShowDiscoveryAnimation] = useState(false);

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
      
      // フラグメント発見時はアニメーションを表示
      if (result.fragments_found && result.fragments_found.length > 0) {
        setShowDiscoveryAnimation(true);
        // アニメーション後に結果ダイアログを表示
        setTimeout(() => {
          setShowDiscoveryAnimation(false);
          setResultDialogOpen(true);
        }, 2500);
      } else {
        setResultDialogOpen(true);
      }
    } finally {
      setConfirmDialogOpen(false);
      setSelectedArea(null);
    }
  };

  // 最高レアリティを取得
  const getHighestRarity = () => {
    if (!explorationResult?.fragments_found) return 'COMMON';
    const rarities = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];
    const foundRarities = explorationResult.fragments_found.map((f: any) => f.rarity);
    return rarities.reverse().find(r => foundRarities.includes(r)) || 'COMMON';
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
                <motion.div
                  whileHover={{ scale: canAfford ? 1.05 : 1 }}
                  whileTap={{ scale: canAfford ? 0.95 : 1 }}
                >
                  <Button
                    size="sm"
                    onClick={() => handleExploreClick(area)}
                    disabled={!canAfford}
                    className="relative overflow-hidden"
                  >
                    <motion.span
                      className="relative z-10 flex items-center"
                    >
                      探索する
                      <Search className="h-4 w-4 ml-1" />
                    </motion.span>
                    {canAfford && (
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                        animate={{
                          x: ["-100%", "100%"]
                        }}
                        transition={{
                          repeat: Infinity,
                          duration: 3,
                          ease: "linear"
                        }}
                      />
                    )}
                  </Button>
                </motion.div>
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
            <DialogTitle>
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2"
              >
                探索結果
                {explorationResult?.fragments_found?.length > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.3, type: "spring" }}
                    className="text-sm font-normal text-purple-600"
                  >
                    – {explorationResult.fragments_found.length}個のフラグメント発見！
                  </motion.span>
                )}
              </motion.div>
            </DialogTitle>
          </DialogHeader>
          {explorationResult && (
            <motion.div 
              className="space-y-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <motion.div 
                className="prose prose-sm max-w-none"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <p>{explorationResult.narrative}</p>
              </motion.div>
              
              {explorationResult.fragments_found.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">発見したログフラグメント</h4>
                  <div className="space-y-2">
                    <AnimatePresence>
                      {explorationResult.fragments_found.map((fragment: any, index: number) => (
                        <motion.div
                          key={index}
                          initial={{ opacity: 0, scale: 0.8, y: 20 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          transition={{
                            duration: 0.5,
                            delay: index * 0.2,
                            type: "spring",
                            stiffness: 200,
                            damping: 20
                          }}
                        >
                          <motion.div
                            whileHover={{ scale: 1.02 }}
                            transition={{ duration: 0.2 }}
                          >
                            <Card className="overflow-hidden">
                              <motion.div
                                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                                initial={{ x: "-100%" }}
                                animate={{ x: "100%" }}
                                transition={{
                                  duration: 1.5,
                                  delay: index * 0.2 + 0.5,
                                  ease: "easeInOut"
                                }}
                              />
                              <CardContent className="py-3 relative">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <motion.div
                                      initial={{ opacity: 0 }}
                                      animate={{ opacity: 1 }}
                                      transition={{ delay: index * 0.2 + 0.3 }}
                                    >
                                      <p className="font-medium flex items-center gap-2">
                                        <motion.div
                                          animate={{
                                            rotate: [0, 360],
                                            scale: [1, 1.2, 1]
                                          }}
                                          transition={{
                                            duration: 2,
                                            delay: index * 0.2,
                                            repeat: 1
                                          }}
                                        >
                                          <Sparkles className="h-4 w-4 text-purple-600" />
                                        </motion.div>
                                        {fragment.keyword}
                                      </p>
                                      <p className="text-sm text-muted-foreground mt-1">
                                        {fragment.description}
                                      </p>
                                    </motion.div>
                                  </div>
                                  <motion.div
                                    initial={{ scale: 0, rotate: -180 }}
                                    animate={{ scale: 1, rotate: 0 }}
                                    transition={{
                                      type: "spring",
                                      stiffness: 200,
                                      damping: 15,
                                      delay: index * 0.2 + 0.4
                                    }}
                                  >
                                    <Badge 
                                      className={`
                                        ${fragment.rarity === 'LEGENDARY' ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white' : ''}
                                        ${fragment.rarity === 'EPIC' ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white' : ''}
                                        ${fragment.rarity === 'RARE' ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white' : ''}
                                        ${fragment.rarity === 'UNCOMMON' ? 'bg-gradient-to-r from-green-500 to-green-600 text-white' : ''}
                                        ${fragment.rarity === 'COMMON' ? 'bg-gradient-to-r from-gray-500 to-gray-600 text-white' : ''}
                                      `}
                                    >
                                      {fragment.rarity}
                                    </Badge>
                                  </motion.div>
                                </div>
                              </CardContent>
                            </Card>
                          </motion.div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}
              
              <motion.div 
                className="flex items-center justify-between text-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
              >
                <span>消費SP: {explorationResult.sp_consumed}</span>
                <span>残りSP: {explorationResult.remaining_sp}</span>
              </motion.div>
            </motion.div>
          )}
          <DialogFooter>
            <Button onClick={() => setResultDialogOpen(false)}>
              閉じる
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* フラグメント発見アニメーション */}
      <FragmentDiscoveryAnimation
        isDiscovering={showDiscoveryAnimation}
        fragmentCount={explorationResult?.fragments_found?.length || 0}
        rarity={getHighestRarity() as any}
      />
    </>
  );
}