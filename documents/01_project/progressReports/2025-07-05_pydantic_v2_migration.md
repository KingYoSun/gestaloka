# Pydantic V1→V2移行レポート

## 実施日時: 2025-07-05

## 概要
バックエンドコードベースでPydantic V1のパターンをV2に移行しました。プロジェクトは既にPydantic V2（2.10.4）を使用していましたが、一部のコードにV1のパターンが残っていたため、完全にV2対応に更新しました。

## 実施した変更

### 1. @validator → @field_validator の移行
以下のファイルで`@validator`デコレータを`@field_validator`に変更：

#### app/schemas/user.py
- 2箇所の`@validator`を`@field_validator`に変更
- `model_config: ClassVar = {"from_attributes": True}`を`model_config = {"from_attributes": True}`に簡略化

#### app/schemas/auth.py
- 3箇所の`@validator`を`@field_validator`に変更
- `confirm_password`バリデータで`values`パラメータを`info`パラメータに変更
- `info.data`を使用して他のフィールドの値にアクセスするように修正

### 2. .from_orm() → .model_validate() の移行
以下のファイルで`.from_orm()`メソッドを`.model_validate()`に変更：

#### app/services/character_service.py
- 4箇所の`Character.from_orm()`を`Character.model_validate()`に変更
  - `get_by_id`メソッド（1箇所）
  - `get_by_user`メソッド（1箇所）
  - `create`メソッド（1箇所）
  - `update`メソッド（1箇所）

#### app/services/exploration_minimap_service.py
- 2箇所の`ExplorationProgressInDB.from_orm()`を`ExplorationProgressInDB.model_validate()`に変更
  - `get_map_data`メソッド（1箇所）
  - `update_exploration_progress`メソッド（1箇所）

### 3. .dict() → .model_dump() の移行
以下のファイルで`.dict()`メソッドを`.model_dump()`に変更：

#### app/services/game_session.py
- 5箇所の`battle_data.dict()`を`battle_data.model_dump()`に変更
  - 戦闘データの保存処理（3箇所）
  - WebSocketイベント送信（1箇所）
  - 敵ターン処理（1箇所）

## テスト結果
移行後のテスト実行結果：
- **バックエンドテスト**: 229個中228個成功（99.6%）
  - 失敗した1つのテストはPydantic移行とは無関係（ランダム性に関するテスト）
- **型チェック**: エラー1件（Pydantic移行とは無関係）
- **リント**: エラー58件（Pydantic移行とは無関係）

## 移行のメリット
1. **将来性**: Pydantic V3でV1パターンが削除される前に対応完了
2. **パフォーマンス**: V2の最適化を活用
3. **保守性**: 最新のベストプラクティスに準拠
4. **警告の削減**: 非推奨警告が表示されなくなる

## 注意点
- `field_validator`で他のフィールドにアクセスする場合、`info.data`を使用
- `info.data`には検証時点で既に検証済みのフィールドのみが含まれる
- フィールドの検証順序は定義順なので、順序に注意が必要

## 今後の課題
- `Config`クラスベースの設定を使用している箇所があれば、`ConfigDict`への移行を検討
- Neo4jとRedisの接続管理の改善（別の技術的債務として管理）