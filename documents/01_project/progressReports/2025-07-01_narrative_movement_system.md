# 物語主導型移動システム実装

## 実施日: 2025-07-01

## 概要
ゲスタロカの移動システムを、従来のゲーム的な直接操作から物語主導型に移行。プレイヤーは移動先を直接選択するのではなく、行動選択が物語を生成し、その結果として自然に場所が変化する仕組みを実装。

## 背景
- 既存のミニマップは直接クリックで移動する仕様
- テキストベースMMOとしての物語体験を重視する方針との不整合
- より没入感のある探索体験の実現が必要

## 実装内容

### 1. ミニマップのview-onlyモード実装
**ファイル**: `frontend/src/features/exploration/minimap/Minimap.tsx`

- `interactionMode`プロパティを追加（'interactive' | 'view-only'）
- view-onlyモードでの動作変更：
  - クリック時は場所情報の表示のみ
  - 移動確認ダイアログを無効化
  - 右クリックメニューを「詳細を見る」に変更

### 2. 物語による移動API実装
**ファイル**: `backend/app/api/api_v1/endpoints/narrative.py`

#### エンドポイント
- `POST /narrative/{character_id}/action` - 物語アクションの実行
- `GET /narrative/{character_id}/actions` - 利用可能な行動取得

#### 主要機能
- GM AIによる物語生成と場所遷移判定
- SP消費の物語への組み込み
- 行動選択肢の動的生成（場所の接続に基づく）
- WebSocketによるリアルタイム通知

### 3. GM AIサービス実装
**ファイル**: `backend/app/services/gm_ai_service.py`

- 物語生成プロンプトの構築
- AI応答から場所変更の解析
- SP消費の自動計算
- イベント発生の判定

### 4. フロントエンド物語インターフェース
**ファイル**: `frontend/src/features/narrative/NarrativeInterface.tsx`

- 物語履歴の表示（スクロール可能）
- 行動選択肢の動的表示
- ミニマップとの統合（サイドパネル、view-onlyモード）
- 場所情報の表示機能

### 5. WebSocketイベント連携
- `narrative:location_changed`イベントの実装
- ミニマップの自動更新
- 移動アニメーション通知

## 技術的な変更点

### スキーマ定義
**ファイル**: `backend/app/schemas/narrative.py`

```python
class ActionRequest(BaseModel):
    text: str  # プレイヤーが選択した行動
    context: Optional[dict[str, Any]]  # 追加コンテキスト

class NarrativeResponse(BaseModel):
    narrative: str  # 生成された物語
    location_changed: bool  # 場所変更フラグ
    new_location_id: Optional[str]
    new_location_name: Optional[str]
    sp_consumed: int
    action_choices: list[ActionChoice]  # 次の選択肢
    events: Optional[list[LocationEvent]]
```

### 行動選択肢の生成
- 基本行動：「周囲を詳しく調べる」「休憩する」
- 場所依存：接続された場所への移動選択肢
- 文脈依存：物語内容に応じた特殊選択肢

## 移行による変更

### Before（ゲーム的な直接操作）
1. ミニマップ上で移動先をクリック
2. 「○○へ移動しますか？必要SP: X」ダイアログ
3. 「移動する」ボタンで実行

### After（物語主導型）
1. 行動選択肢から選択（例：「階段を上る」）
2. GM AIが物語を生成
3. 物語の中で自然に移動が発生
4. ミニマップが自動更新

## 課題と今後の改善点

1. **LLMサービスの本実装**
   - 現在は仮実装（`llm_service.py`）
   - Gemini APIとの統合が必要

2. **WebSocketサービスの完全実装**
   - 現在は仮実装（`websocket_service.py`）
   - 実際のブロードキャスト機能が必要

3. **物語の一貫性**
   - セッション間での文脈保持
   - 長期的な物語の連続性

4. **パフォーマンス最適化**
   - AI応答のキャッシング
   - 選択肢生成の最適化

## テスト結果
- バックエンドテスト: 229/229 PASSED ✓
- フロントエンドテスト: 40/40 PASSED ✓
- リントチェック: PASSED ✓
- 型チェック: PASSED（一部警告あり）

## まとめ
物語主導型移動システムの実装により、ゲスタロカはより没入感のあるテキストベースMMO体験を提供できるようになった。プレイヤーは「移動する」という機械的な操作から解放され、物語の中で自然に世界を探索できる。