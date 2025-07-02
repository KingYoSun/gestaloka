# クエストシステムUIの実装ガイド

## 概要
このドキュメントでは、動的クエストシステムのフロントエンドUI実装について説明します。

## アーキテクチャ

### コンポーネント構成
```
components/quests/
├── QuestPanel.tsx        # メインコンテナ
├── QuestProposals.tsx    # GM提案表示
├── ActiveQuests.tsx      # 進行中クエスト
├── QuestHistory.tsx      # 履歴表示
├── QuestDeclaration.tsx  # プレイヤー宣言
├── QuestStatusWidget.tsx # ゲーム内ウィジェット
└── index.ts             # エクスポート
```

### データフロー
1. **API → React Query → カスタムフック → コンポーネント**
2. **WebSocket → イベントリスナー → React Query キャッシュ更新**
3. **ユーザーアクション → ミューテーション → API → 楽観的更新**

## 主要コンポーネント

### QuestPanel
統合的なクエスト管理インターフェース。

```typescript
<Tabs value={activeTab} onValueChange={setActiveTab}>
  <TabsList>
    <TabsTrigger value="active">進行中</TabsTrigger>
    <TabsTrigger value="proposals">提案</TabsTrigger>
    <TabsTrigger value="declare">宣言</TabsTrigger>
    <TabsTrigger value="history">履歴</TabsTrigger>
  </TabsList>
  <TabsContent>...</TabsContent>
</Tabs>
```

### ActiveQuests
進行中のクエストを管理する中核コンポーネント。

#### 主要機能
- 複数の進行度指標表示
- リアルタイム進行状況更新
- キーイベントのスクロール表示

```typescript
// 3つの進行度指標
<Progress value={quest.progress_percentage} />
<Progress value={quest.narrative_completeness * 100} />
<Progress value={quest.emotional_satisfaction * 100} />
```

### QuestProposals
GMからの提案を表示・受諾するコンポーネント。

#### 提案受諾フロー
1. 提案一覧からクエストを選択
2. 新規クエストとして作成
3. 自動的に受諾してアクティブ化

```typescript
const handleAccept = async (proposal: QuestProposal) => {
  const newQuest = await createQuest.mutateAsync({
    title: proposal.title,
    description: proposal.description,
    origin: proposal.origin
  });
  await acceptQuest.mutateAsync(newQuest.id);
};
```

## カスタムフック

### useQuests
クエスト一覧を管理する基本フック。

```typescript
export function useQuests(characterId?: string, status?: QuestStatus) {
  const questsQuery = useQuery({
    queryKey: ['quests', characterId, status],
    queryFn: () => questsApi.getQuests(characterId, { status }),
    enabled: !!characterId,
  });

  // WebSocket連携
  useEffect(() => {
    on('quest_created', handleQuestUpdate);
    on('quest_updated', handleQuestUpdate);
    on('quest_completed', handleQuestUpdate);
  }, []);

  return { quests, isLoading, error, refetch };
}
```

### useActiveQuests
進行中のクエストに特化したフック。

```typescript
export function useActiveQuests(characterId?: string) {
  const { quests, ...rest } = useQuests(characterId);
  
  const activeQuests = quests.filter(
    quest => [
      QuestStatus.ACTIVE,
      QuestStatus.PROGRESSING,
      QuestStatus.NEAR_COMPLETION
    ].includes(quest.status)
  );

  return { activeQuests, ...rest };
}
```

## WebSocket統合

### イベント処理
```typescript
// クエスト関連イベント
- quest_created: 新規クエスト作成時
- quest_updated: 進行状況更新時
- quest_completed: クエスト完了時

// 処理例
const handleQuestUpdate = (data: any) => {
  if (data.character_id === characterId) {
    queryClient.invalidateQueries(['quests', characterId]);
  }
};
```

## 暗黙的クエスト推測

### 自動実行
```typescript
useEffect(() => {
  const inferImplicitQuestPeriodically = async () => {
    const quest = await inferQuest.mutateAsync();
    if (quest) {
      toast.success(`新しいクエストが推測されました`);
    }
  };

  // 5分ごとに実行
  const interval = setInterval(inferImplicitQuestPeriodically, 5 * 60 * 1000);
  return () => clearInterval(interval);
}, [characterId]);
```

## スタイリング

### Tailwind CSSクラス
- カード: `hover:shadow-lg transition-shadow`
- バッジ: `variant="secondary"` for counts
- プログレスバー: `h-2` for main, `h-1.5` for sub-metrics
- アイコン: Lucideアイコンを統一使用

### レスポンシブデザイン
```typescript
<div className="grid gap-4 md:grid-cols-2">
  {activeQuests.map(quest => (
    <QuestCard key={quest.id} quest={quest} />
  ))}
</div>
```

## エラーハンドリング

### ローディング状態
```typescript
if (isLoading) {
  return (
    <div className="space-y-4">
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
    </div>
  );
}
```

### エラー表示
```typescript
if (error) {
  return (
    <Alert variant="destructive">
      <AlertDescription>
        クエスト一覧の取得に失敗しました
      </AlertDescription>
    </Alert>
  );
}
```

## パフォーマンス最適化

### React Query設定
- `staleTime: 1000 * 60 * 5` - 5分間キャッシュ
- 楽観的更新による即座のUI反映
- 選択的なクエリ無効化

### コンポーネント最適化
- `useCallback`によるコールバック最適化
- 条件付きレンダリングによる不要な処理削減

## テスト方針

### ユニットテスト
- カスタムフックのロジックテスト
- コンポーネントの表示テスト
- エラーケースの処理確認

### 統合テスト
- API連携の確認
- WebSocket更新の動作確認
- ユーザーフローの検証

## 今後の拡張

### 機能追加案
1. クエストのフィルタリング・ソート
2. クエスト間の依存関係表示
3. 進行状況のグラフ表示
4. クエスト達成時のアニメーション

### 改善点
1. TypeScript型定義の強化
2. エラーリトライ機構の実装
3. オフライン対応の検討