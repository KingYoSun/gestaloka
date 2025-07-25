# 2025/06/22 ログシステム再設計レポート

## 概要
ログシステムの根本的な仕様変更を実施。「契約」ベースのマーケットプレイスから、独立したNPCとしての「ログ派遣」システムへと転換。さらに、持続可能な運営のためのSPシステムを導入。

## 主要な変更点

### 1. ログの位置づけの変更
**変更前**: プレイヤー間で契約・取引される存在
**変更後**: プレイヤーが創造し、世界へ送り出す独立したNPCエンティティ

#### 新しいコンセプト
- ログは創造主から独立した存在として世界を旅する
- 他のプレイヤーにとっては通常のNPCと同様に出会い、交流できる
- 派遣期間終了後、成果と物語を持って創造主の元へ帰還

### 2. SPシステムの導入
**SP（Story Points）**: 表向き「行動力」、実質「世界への干渉力」

#### SPの設計理念
- LLM APIコストを抽象化したゲーム内リソース
- 無料プレイヤーも基本的な体験は可能
- 課金により、より深い物語体験が可能に

#### SP消費項目
- プレイヤーの自由行動宣言: 1-5 SP
- ログ派遣: 10-300 SP（期間による）
- 特殊機能: 緊急召還、能力強化など

#### マネタイズモデル
- 自然回復: 10 SP/日（無料）
- 直接購入: 100 SP = ¥500から
- 月額パス: ¥1,000-2,500

### 3. ログ派遣システム
#### 派遣フロー
1. **準備**: ログ選択、目的設定、初期地点設定
2. **派遣中**: AIによる自律行動、他プレイヤーとの遭遇
3. **帰還**: 成果報告、報酬獲得、SP還元

#### 派遣タイプ
- 探索型: 特定の場所や情報を探す
- 交流型: 条件を持つ人物との出会い
- 収集型: アイテムや情報の収集
- 護衛型: 場所や人物を守る
- 自由型: ログの性格に任せた行動

## 実装した仕様書

### 新規作成
1. `documents/03_worldbuilding/game_mechanics/logDispatchSystem.md`
   - ログ派遣システムの詳細仕様
   - 派遣フロー、成果報告、技術仕様

2. `documents/03_worldbuilding/game_mechanics/spSystem.md`
   - SPシステムの包括的仕様
   - 消費項目、回復方法、マネタイズ設計

### 更新・改訂
1. `documents/03_worldbuilding/game_mechanics/log.md`
   - ログの独立性を強調
   - 契約システムから派遣システムへ変更
   - SPシステムの統合

2. `documents/SUMMARY.md`
   - 実装状況の更新
   - 現在の優先タスクの変更

3. `README.md`
   - プロジェクト概要の更新
   - 実装状況セクションの追加

### 削除
- `documents/03_worldbuilding/game_mechanics/logMarketplace.md`
  - 契約ベースのマーケットプレイスは廃止

## 技術的影響

### データモデルの変更
- `LogContract`テーブル → `LogDispatch`テーブル
- `PlayerSP`テーブルの新規追加
- 契約関連のフィールドを派遣関連に変更

### API設計の変更
- 契約APIから派遣APIへ
- SP管理APIの追加
- 遭遇システムAPIの設計

## 今後の実装優先順位

### Phase 1: 基本システム
1. SPシステムの実装
2. ログ派遣UIの基本機能
3. 簡易的な活動シミュレーション

### Phase 2: 遭遇システム
1. 他プレイヤーのセッションへのログ出現
2. 交流記録システム

### Phase 3: マネタイズ
1. SP購入システム
2. 月額パスの実装

## 設計思想の進化

### 従来の設計
- プレイヤー間の直接的な価値交換
- 契約による制約的な関係
- マーケットプレイスでの競争

### 新しい設計
- ログの独立性と自由な冒険
- 間接的で有機的なプレイヤー交流
- 物語生成への貢献度に応じた報酬

この変更により、ゲスタロカはより自然で豊かな物語体験を提供できるようになりました。