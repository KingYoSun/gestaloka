# 未使用コード検出レポート

作成日: 2025-07-15

## 概要

バックエンドとフロントエンドのコードベースを調査し、未使用のメソッド、変数、クラス、インポートを検出しました。

## バックエンド

### 未使用の変数

1. **`app/services/battle.py` - 33行目**
   ```python
   def check_battle_trigger(self, action_result: dict[str, Any], session_data: dict[str, Any]) -> bool:
   ```
   - `session_data`パラメータが定義されているが関数内で使用されていない

2. **`app/tasks/ai_tasks.py` - 39行目**
   ```python
   def generate_log_npc(self, log_fragments: list, target_world_context: dict):
   ```
   - `target_world_context`パラメータが定義されているが関数内で使用されていない

3. **`app/api/api_v1/endpoints/dispatch.py` - 407行目**
   ```python
   encounter_id: str,
   ```
   - `encounter_id`パラメータがパスパラメータとして定義されているが関数内で使用されていない
   - TODOコメントがあり、実装が未完成の状態

### 未使用のクラス

1. **`app/services/ai/utils.py` - ContextEnhancerクラス**
   - クラスが定義されているが、どこからも参照されていない
   - 将来的な拡張のために用意されている可能性がある

2. **`app/services/battle.py` - BattleServiceクラス**
   - 実際のアプリケーションコードでは使用されていない
   - テストファイル（`tests/test_battle_service.py`）でのみ使用されている
   - 戦闘システムの実装が保留されている可能性がある

### 未使用の可能性があるメソッド

バックエンドには371個の関数定義があり、すべてを手動で確認することは困難ですが、主要なサービスクラスのメソッドは概ね使用されているように見えます。

## フロントエンド

### 未使用のコンポーネント・関数

フロントエンドのコードは比較的よく整理されており、以下のような使用状況が確認されました：

1. **`useToast`フック** - 17ファイルで44回使用されている
2. **`caseConverter`ユーティリティ** - APIクライアントで適切に使用されている
3. **`formatNumber`ユーティリティ** - 4ファイルで15回使用されている

### アーカイブされたコード

`/archived/game_session_v1/`ディレクトリには古いバージョンのゲームセッション実装が含まれています。これらは現在使用されていませんが、参照用に保持されているようです。

## 推奨事項

### 即座に対処すべき項目

1. **未使用パラメータの削除または使用**
   - `battle.py`の`session_data`
   - `ai_tasks.py`の`target_world_context`
   - `dispatch.py`の`encounter_id`

2. **未使用クラスの評価**
   - `ContextEnhancer`クラスが将来使用予定でなければ削除を検討
   - `BattleService`クラスの実装を完成させるか、削除を検討

### 中期的な対処項目

1. **TODOコメントの解決**
   - `dispatch.py`の遭遇IDからdispatch_idを取得する仕組みの実装

2. **アーカイブコードの管理**
   - `/archived/`ディレクトリのコードが本当に必要か評価
   - 不要な場合は削除してリポジトリサイズを削減

### コード品質の維持

1. **定期的な未使用コード検出**
   - CI/CDパイプラインに未使用コード検出を組み込む
   - Python: `vulture`または`flake8`の使用
   - TypeScript: ESLintの`no-unused-vars`ルールの活用

2. **コードレビューでの確認**
   - 新しいコードを追加する際は、既存の未使用コードがないか確認
   - リファクタリング時に未使用コードを積極的に削除

## 結論

全体的にコードベースはよく管理されており、深刻な未使用コードの蓄積は見られません。ただし、いくつかの未使用パラメータとクラスが存在し、これらは実装の未完成または将来の拡張のために残されている可能性があります。

定期的な未使用コード検出と削除により、コードベースをクリーンに保つことができます。