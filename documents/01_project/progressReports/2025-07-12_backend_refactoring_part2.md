# バックエンドリファクタリング継続作業報告（第2回）

作成日: 2025-07-12 20:47 JST

## 概要
プロジェクト全体のリファクタリング作業の一環として、バックエンドコードのDRY原則違反と未使用コードの追加チェックを実施。共通化可能なエラーハンドリングを統一し、コードの保守性を向上させた。

## 実施内容

### 1. 未使用コードの削除
- **バックアップファイルと空ディレクトリの削除**
  - `app/services/sp_service.py.backup`
  - `app/api/endpoints/` （空ディレクトリ）
  - `app/models/game/` （空ディレクトリ）
  - `app/ai/agents/` （空ディレクトリ）

### 2. 共通エラーハンドリングの実装
- **`app/utils/exceptions.py`を新規作成**
  - `raise_not_found()`: 404エラーの共通関数
  - `raise_forbidden()`: 403エラーの共通関数
  - `raise_bad_request()`: 400エラーの共通関数
  - `raise_internal_error()`: 500エラーの共通関数
  - `get_or_404()`: IDでモデルを取得し、存在しない場合は404エラー
  - `get_by_condition_or_404()`: 条件でモデルを取得し、存在しない場合は404エラー
  - `handle_sp_errors()`: SP関連エラーを自動的にHTTPExceptionに変換するデコレータ

### 3. DRY原則違反の修正

#### HTTPException 404エラーの統一（4箇所→1箇所）
**修正ファイル**:
- `app/api/api_v1/endpoints/titles.py`
  - キャラクター取得の重複コード4箇所を共通化
  - `raise HTTPException(404, ...)` → `get_by_condition_or_404()`
  
- `app/api/api_v1/endpoints/logs.py`
  - キャラクター取得とセッション取得の重複コードを共通化
  - datetime.utcnow() → datetime.now(UTC) に置き換え（2箇所）

#### SP関連エラーハンドリングの統一
**修正ファイル**: `app/api/api_v1/endpoints/sp.py`
- SPSystemError → HTTPException 500 のパターン（5箇所）を`@handle_sp_errors`デコレータで統一
- InsufficientSPError → HTTPException 400 のパターンも同様に統一
- try-except ブロックの削除により、コード行数を約30%削減

### 4. datetime.utcnow()の部分的な置き換え
Python 3.12で非推奨となるdatetime.utcnow()をdatetime.now(UTC)に置き換え：
- `app/utils/security.py` （3箇所）
- `app/services/auth_service.py` （3箇所）
- `app/api/api_v1/endpoints/logs.py` （2箇所）

**残り**: 36ファイル中28ファイルが未対応

## 技術的な改善点

### 1. エラーハンドリングの一元化
- 共通のエラーパターンを関数化・デコレータ化
- エラーメッセージの統一性向上
- ロギングの一貫性確保

### 2. コードの可読性向上
- 重複コードの削減により、ビジネスロジックが明確に
- デコレータによる宣言的なエラーハンドリング

### 3. 保守性の向上
- エラーハンドリングの変更が1箇所で可能
- 新規エンドポイント作成時の実装ミス防止

## 問題と解決

### Python 3.11での型パラメータ構文エラー
- 当初の実装: `def get_or_404[T: SQLModel](...) -> T:`
- Python 3.11ではPEP 695の型パラメータ構文が未サポート
- 解決: 通常の型ヒントに変更 `def get_or_404(...) -> SQLModel:`

## 成果
- **テスト成功率**: 203/203（100%）
- **コード削減**: SP関連エンドポイントで約30%のコード削減
- **保守性向上**: エラーハンドリングの一元化により将来の変更が容易に

## 未実施項目

### 1. 遭遇ストーリーシステムの扱い
- 関連ファイル:
  - `app/models/encounter_story.py`
  - `app/services/encounter_manager.py`
  - `app/services/story_progression_manager.py`
- 現状: 設計は存在するが未実装、現在のタスクに含まれていない
- 推奨: 将来的に実装予定がなければ削除を検討

### 2. Location取得の重複（encounter_manager.pyで6箇所）
```python
location = self.db.exec(select(Location).where(Location.name == context.location)).first()
```
- 遭遇システムが未使用のため、優先度低

### 3. datetime.utcnow()の残り（28ファイル）
- 一括置換スクリプトの作成を推奨

## 次回の作業
1. フロントエンドのDRY原則違反チェック
2. ユニットテストカバレッジの向上
3. datetime.utcnow()の全体的な置き換え
4. ドキュメントとコードの整合性チェック

## 参考
- 前回のリファクタリング報告: `2025-07-12_backend_refactoring.md`
- 関連Issue: DRY原則違反の解消、技術的債務の削減