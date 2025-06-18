# 歴史家AI (Historian) 仕様書

## 1. 概要

歴史家AI（Historian）は、GM AI評議会の一員として、ゲスタロカで起こるすべての出来事を記録・整理し、世界の歴史として編纂する役割を担います。プレイヤーの行動、NPC との相互作用、世界イベントなどを一貫性のある物語として保存し、将来的なログNPC化の基盤となるデータを管理します。

## 2. 責務と役割

### 2.1 主要責務

1. **行動記録管理**
   - プレイヤーのすべての行動をタイムスタンプ付きで記録
   - 行動の文脈情報（場所、同行者、状況）を保存
   - 行動の重要度を評価し、カテゴライズ

2. **歴史編纂**
   - 個々の行動を時系列で整理
   - 因果関係を分析し、物語として構造化
   - 世界の歴史年表を維持・更新

3. **一貫性保証**
   - 時系列の矛盾を検出・修正
   - 場所や人物の状態の一貫性を確認
   - 他のAIが生成した内容との整合性チェック

4. **ログ基盤提供**
   - ログの欠片として価値のある行動を識別
   - ログNPC化に必要な情報を構造化
   - 他プレイヤーの世界への転送用データを準備

### 2.2 副次的役割

- 他のAIに歴史的コンテキストを提供
- プレイヤーに過去の行動履歴を参照可能にする
- 世界の出来事の統計情報を管理

## 3. インターフェース

### 3.1 入力

```python
class HistorianInput:
    session_id: str
    action_type: ActionType  # PLAYER_ACTION, NPC_INTERACTION, WORLD_EVENT
    actor_id: str
    action_details: Dict[str, Any]
    context: HistoricalContext
    timestamp: datetime
```

### 3.2 出力

```python
class HistorianOutput:
    record_id: str
    is_recorded: bool
    importance_level: int  # 1-10
    categorization: List[str]
    log_fragment_potential: float  # 0.0-1.0
    historical_context: Dict[str, Any]
    consistency_warnings: List[str]
```

### 3.3 内部データ構造

```python
class HistoricalRecord:
    id: str
    session_id: str
    actor_id: str
    action_type: ActionType
    action_details: Dict[str, Any]
    location: LocationInfo
    participants: List[str]
    timestamp: datetime
    importance_level: int
    tags: List[str]
    consequences: List[str]
    related_records: List[str]
```

## 4. 処理フロー

### 4.1 行動記録プロセス

1. **受信と検証**
   - 入力データの完全性チェック
   - タイムスタンプの妥当性確認
   - アクターの存在確認

2. **コンテキスト拡張**
   - 現在の場所情報を取得
   - 関連するNPCや他プレイヤーを特定
   - 前後の行動との関連性を分析

3. **重要度評価**
   - 行動の世界への影響度を算出
   - 他のキャラクターへの影響を評価
   - ストーリー上の重要性を判定

4. **カテゴライズ**
   - 行動をタグ付け（戦闘、探索、社交、創造等）
   - ログの欠片としての適性を評価
   - 関連する既存記録とリンク

5. **永続化**
   - PostgreSQLに構造化データを保存
   - Neo4jに関係性データを記録
   - インデックスを更新

### 4.2 歴史編纂プロセス

1. **定期的な整理**
   - 一定期間ごとに記録を集約
   - 時系列で物語を構造化
   - 重要イベントを抽出

2. **一貫性チェック**
   - 時間的矛盾の検出
   - 空間的矛盾の検出
   - 因果関係の妥当性確認

3. **年表更新**
   - 世界史年表への新規エントリ追加
   - 既存エントリの更新
   - クロスリファレンスの作成

## 5. 他AIとの協調

### 5.1 脚本家AI（Dramatist）との連携
- 生成された物語の記録を受信
- 歴史的文脈を提供して物語生成を支援
- 一貫性のフィードバックを送信

### 5.2 状態管理AI（State Manager）との連携
- ゲーム状態の変更を記録
- 状態変更の歴史的妥当性を検証
- ロールバック用の履歴データを提供

### 5.3 NPC管理AI（NPC Manager）との連携
- NPC の行動履歴を管理
- ログNPC化のための基礎データを提供
- NPC の性格形成に歴史的背景を提供

### 5.4 世界の意識AI（The World）との連携
- マクロイベントの記録
- 世界規模の変化の追跡
- 歴史的トレンドの分析結果を共有

### 5.5 混沌AI（The Anomaly）との連携
- 予測不能なイベントの記録
- 異常事象の頻度と影響を追跡
- カオス要素の歴史的パターンを分析

## 6. データベース設計

### 6.1 PostgreSQL スキーマ

```sql
-- 行動記録テーブル
CREATE TABLE historical_records (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL,
    actor_id UUID NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    action_details JSONB NOT NULL,
    location_info JSONB NOT NULL,
    participants UUID[] NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    importance_level INTEGER CHECK (importance_level BETWEEN 1 AND 10),
    tags TEXT[] NOT NULL,
    consequences TEXT[] NOT NULL,
    log_fragment_potential FLOAT CHECK (log_fragment_potential BETWEEN 0 AND 1),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES game_sessions(id),
    FOREIGN KEY (actor_id) REFERENCES characters(id)
);

-- 世界史年表テーブル
CREATE TABLE world_chronicle (
    id UUID PRIMARY KEY,
    era VARCHAR(100) NOT NULL,
    year INTEGER NOT NULL,
    season VARCHAR(20),
    event_title VARCHAR(255) NOT NULL,
    event_description TEXT NOT NULL,
    significance_level INTEGER CHECK (significance_level BETWEEN 1 AND 10),
    related_records UUID[] NOT NULL,
    affected_regions TEXT[] NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- インデックス
CREATE INDEX idx_historical_records_session ON historical_records(session_id);
CREATE INDEX idx_historical_records_actor ON historical_records(actor_id);
CREATE INDEX idx_historical_records_timestamp ON historical_records(timestamp);
CREATE INDEX idx_historical_records_importance ON historical_records(importance_level);
CREATE INDEX idx_world_chronicle_era_year ON world_chronicle(era, year);
```

### 6.2 Neo4j データモデル

```cypher
// 行動記録ノード
CREATE (hr:HistoricalRecord {
    id: $id,
    timestamp: $timestamp,
    importance_level: $importance_level,
    action_type: $action_type
})

// 関係性
// 行動の実行者
CREATE (character)-[:PERFORMED]->(hr)

// 行動の影響を受けた対象
CREATE (hr)-[:AFFECTED]->(target)

// 行動が発生した場所
CREATE (hr)-[:OCCURRED_AT]->(location)

// 行動間の因果関係
CREATE (hr1)-[:CAUSED]->(hr2)

// 行動とログの欠片の関係
CREATE (hr)-[:POTENTIAL_FRAGMENT {potential: $potential}]->(logFragment)
```

## 7. 実装上の考慮事項

### 7.1 パフォーマンス最適化
- 頻繁にアクセスされる最近の記録はキャッシュ
- 古い記録は定期的にアーカイブ
- インデックスの適切な管理

### 7.2 スケーラビリティ
- 記録の分割保存（時期別、プレイヤー別）
- 非同期処理による記録の遅延書き込み
- 読み取り専用レプリカの活用

### 7.3 データ整合性
- トランザクション管理の徹底
- 定期的な整合性チェックジョブ
- バックアップとリカバリ戦略

### 7.4 プライバシーとセキュリティ
- プレイヤー間の記録の適切な分離
- ログNPC化時の個人情報の匿名化
- アクセス権限の厳密な管理

## 8. 品質基準

### 8.1 記録の完全性
- すべての重要な行動が記録されること
- タイムスタンプの精度が保証されること
- 欠損データがないこと

### 8.2 一貫性
- 時系列の矛盾がないこと
- 因果関係が論理的であること
- 他のシステムとの整合性が保たれること

### 8.3 パフォーマンス
- 記録の書き込みが100ms以内
- 履歴検索が500ms以内
- 年表生成が1秒以内

## 9. エラーハンドリング

### 9.1 記録失敗時の対応
- 一時的なキューへの保存
- リトライメカニズム
- 管理者への通知

### 9.2 一貫性エラーの修正
- 自動修正可能な範囲の定義
- 手動介入が必要な場合の通知
- 修正履歴の保持

## 10. 監視とメトリクス

### 10.1 監視項目
- 記録の成功率
- 処理時間の分布
- ストレージ使用量
- 一貫性エラーの発生率

### 10.2 アラート条件
- 記録失敗率が5%を超過
- 処理遅延が継続的に発生
- ストレージ容量の逼迫
- 重大な一貫性エラーの検出