import { useMemoryInheritanceScreen } from '@/hooks/useMemoryInheritance';
import { MemoryFragmentSelector } from './MemoryFragmentSelector';
import { MemoryInheritancePreview } from './MemoryInheritancePreview';
import { MemoryInheritanceHistory } from './MemoryInheritanceHistory';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles } from 'lucide-react';

interface MemoryInheritanceScreenProps {
  characterId: string;
}

export function MemoryInheritanceScreen({ characterId }: MemoryInheritanceScreenProps) {
  const {
    fragments,
    isLoadingFragments,
    selectedFragmentIds,
    selectedType,
    setSelectedType,
    preview,
    isLoadingPreview,
    history,
    isLoadingHistory,
    toggleFragmentSelection,
    clearSelection,
    executeInheritance,
    isExecuting,
    canExecute,
  } = useMemoryInheritanceScreen(characterId);

  return (
    <div className="container mx-auto p-4 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Sparkles className="w-8 h-8 text-purple-500" />
          記憶継承システム
        </h1>
        <p className="text-muted-foreground mt-2">
          記憶フラグメントを組み合わせて、新たな力を獲得しましょう
        </p>
      </div>

      <Tabs defaultValue="inheritance" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="inheritance">記憶継承</TabsTrigger>
          <TabsTrigger value="history">継承履歴</TabsTrigger>
        </TabsList>

        <TabsContent value="inheritance" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 左側：フラグメント選択 */}
            <Card>
              <CardHeader>
                <CardTitle>記憶フラグメントを選択</CardTitle>
                <p className="text-sm text-muted-foreground">
                  最低2つのフラグメントを選択してください
                </p>
              </CardHeader>
              <CardContent>
                {isLoadingFragments ? (
                  <div className="flex items-center justify-center h-64">
                    <Loader2 className="w-8 h-8 animate-spin" />
                  </div>
                ) : fragments.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>記憶フラグメントがありません</p>
                    <p className="text-sm mt-2">
                      クエストを完了して記憶フラグメントを獲得しましょう
                    </p>
                  </div>
                ) : (
                  <MemoryFragmentSelector
                    fragments={fragments}
                    selectedIds={selectedFragmentIds}
                    onToggleSelection={toggleFragmentSelection}
                  />
                )}
              </CardContent>
            </Card>

            {/* 右側：プレビューと実行 */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>継承プレビュー</CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedFragmentIds.length < 2 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>2つ以上のフラグメントを選択してください</p>
                    </div>
                  ) : isLoadingPreview ? (
                    <div className="flex items-center justify-center h-64">
                      <Loader2 className="w-8 h-8 animate-spin" />
                    </div>
                  ) : preview ? (
                    <MemoryInheritancePreview
                      preview={preview}
                      selectedType={selectedType}
                      onSelectType={setSelectedType}
                    />
                  ) : null}
                </CardContent>
              </Card>

              {/* 実行ボタン */}
              <div className="flex gap-2">
                <Button
                  onClick={clearSelection}
                  variant="outline"
                  disabled={selectedFragmentIds.length === 0}
                  className="flex-1"
                >
                  選択をクリア
                </Button>
                <Button
                  onClick={executeInheritance}
                  disabled={!canExecute}
                  className="flex-1"
                >
                  {isExecuting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      継承中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      記憶を継承する
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>継承履歴</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingHistory ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
              ) : (
                <MemoryInheritanceHistory history={history || []} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}