# Gemini API仕様書

**最終更新日:** 2025/06/18  
**ドキュメントバージョン:** 1.2

## 概要

Google Gemini APIは、Google DeepMindが開発した最新の生成AIモデルへのアクセスを提供するAPIです。本ドキュメントでは、ゲスタロカプロジェクトでの統合に必要な仕様をまとめます。

## 使用モデル

### Gemini 2.5 Pro（安定版）
- **モデルID**: `gemini-2.5-pro`
- **旧モデルID**: `gemini-2.5-pro-preview-06-05`（2025/06/18に安定版に更新）
- **コンテキストウィンドウ**: 1,048,576トークン（入力）、65,536トークン（出力）
- **特徴**: 
  - 高度な推論能力と思考機能（Thinking）
  - マルチモーダル対応（テキスト、画像、音声、動画）
  - 適応的思考による複雑な問題解決
  - コード、数学、STEM分野での優れた性能
- **ナレッジカットオフ**: 2025年1月

### Gemini 2.5 Flash（安定版）
- **モデルID**: `gemini-2.5-flash`
- **旧モデルID**: `gemini-2.5-flash-preview-05-20`（2025/06/18に安定版に更新）
- **コンテキストウィンドウ**: 1,048,576トークン（入力）、65,536トークン（出力）
- **用途**: より軽量で高速な処理が必要な場合、価格とパフォーマンスの最適化
- **特徴**: 思考予算の構成が可能、低レイテンシでの大容量タスクに最適

## 料金体系

### Gemini 2.5 Pro
- **200,000トークンまで**:
  - 入力: $1.25 / 100万トークン
  - 出力: $10.00 / 100万トークン
- **200,000トークン以上**:
  - 入力: $2.50 / 100万トークン
  - 出力: $15.00 / 100万トークン

### 無料枠
- 実験版は無料で利用可能（レート制限あり）

## レート制限

### 有料版（公開プレビュー）
- 高いレート制限（具体的な数値は公開されていない）
- 本番環境での使用に適している

### 無料版（実験版）
- 低いレート制限
- 開発・テスト用途向け

## LangChain統合

### インストール

```bash
pip install langchain-google-genai
pip install google-generativeai
```

### 基本的な使用方法

```python
from langchain_google_genai import ChatGoogleGenerativeAI
import os

# APIキーの設定
os.environ["GOOGLE_API_KEY"] = "your-api-key"

# モデルの初期化
llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-pro-preview-06-05",  # 最新版を使用
    temperature=0.7,  # 0.0-2.0の範囲で設定可能（Gemini 2.5）
    max_tokens=None,
    timeout=None,
    max_retries=2,
)

# 基本的な呼び出し
response = llm.invoke("ゲームの物語を生成してください")
print(response.content)

# 注意: langchain-google-genai 2.0.8以降では、temperatureは
# 初期化時にのみ設定可能で、invoke時には変更できません
```

### メッセージ形式

```python
from langchain_core.messages import HumanMessage, SystemMessage

messages = [
    SystemMessage(content="あなたはゲスタロカのGM AIです。"),
    HumanMessage(content="プレイヤーが森を探索しています。")
]

response = llm.invoke(messages)
```

### ストリーミング対応

```python
# ストリーミング
for chunk in llm.stream("物語を生成してください"):
    print(chunk.content, end="")
```

### バッチ処理

```python
# 複数のプロンプトを同時処理
results = llm.batch([
    "キャラクターの行動案1",
    "キャラクターの行動案2",
    "キャラクターの行動案3"
])
```

## セーフティ設定

```python
from langchain_google_genai import (
    ChatGoogleGenerativeAI,
    HarmBlockThreshold,
    HarmCategory,
)

llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-pro-preview-03-25",
    safety_settings={
        HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
        HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
)
```

## エラーハンドリング

### 一般的なエラー

1. **APIキーエラー**
   - 原因: 無効なAPIキー
   - 対処: 環境変数の確認

2. **レート制限エラー**
   - 原因: レート制限超過
   - 対処: リトライロジックの実装、有料版への移行

3. **タイムアウトエラー**
   - 原因: 長いプロンプト処理
   - 対処: タイムアウト値の調整

### リトライ戦略

```python
import time
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=4, max=60)
)
def call_gemini_with_retry(prompt):
    return llm.invoke(prompt)
```

## ベストプラクティス

### 1. コスト最適化
- プロンプトのキャッシング
- バッチ処理の活用
- 必要に応じてGemini 2.5 Flash（gemini-2.5-flash-preview-05-20）を使用

### 2. パフォーマンス最適化
- 非同期処理の活用
- ストリーミングレスポンスの使用
- 適切なタイムアウト設定
- 最新モデルバージョンの使用による性能向上

### 3. セキュリティ
- APIキーの安全な管理（環境変数使用）
- プロンプトインジェクション対策
- 出力の検証とサニタイゼーション

### 4. Temperature設定
- **重要**: langchain-google-genai 2.1.6では、temperatureは直接パラメータとして設定可能
- Gemini 2.5シリーズは0.0～2.0の範囲をサポート（旧バージョンは0.0～1.0）
- 用途別推奨値:
  - 分析・判定タスク: 0.0～0.3（一貫性重視）
  - 一般的な対話: 0.5～0.7（バランス型）
  - 創造的なタスク: 0.8～1.2（多様性重視）
  - 実験的・混沌的な生成: 1.3～2.0（予測不能性）

### 5. 追加パラメータ（2.1.6以降）
- **top_p**: Nucleus sampling（0.0-1.0）- 累積確率による単語選択
- **top_k**: Top-k sampling（1以上）- 上位k個の単語から選択
- **timeout**: API呼び出しタイムアウト（秒）
- **max_retries**: 自動リトライ回数
- **セーフティ設定**: HarmCategory/HarmBlockThresholdによる細かい制御

## ゲスタロカ特有の考慮事項

### 1. GM AI評議会での使用
- 各AIエージェントごとに異なるシステムプロンプト
- コンテキスト共有のための効率的な設計
- 並列処理による応答時間の短縮

### 2. 物語生成
- 世界観に沿った一貫性のある出力
- プレイヤーの行動履歴の効果的な活用
- 動的な選択肢生成

### 3. スケーラビリティ
- 同時接続プレイヤー数に応じたレート管理
- キャッシング戦略の実装
- 非同期処理アーキテクチャ

## モデルバージョン更新履歴

### 2025/07/01
- langchain-google-genai 2.1.5 → 2.1.6へアップグレード
- 直接的なtemperature、timeout、max_retriesパラメータ設定のサポート
- top_p、top_kパラメータの追加サポート
- HarmCategory、HarmBlockThresholdによるセーフティ設定の統合
- AIレスポンスキャッシュシステムの実装（APIコスト削減）
- バッチ処理の並列度制御（最大10並列）による安定性向上

### 2025/06/18
- langchain-google-genai 2.0.8でのtemperature設定方法を明確化
- temperatureパラメータは初期化時にのみ設定可能（invoke時には変更不可）
- Gemini 2.5シリーズの温度範囲を0.0-2.0に更新（従来は0.0-1.0）

### 2025/06/18
- Gemini 2.5 Pro: `gemini-2.5-pro-preview-06-05` → `gemini-2.5-pro`（安定版リリース）
- Gemini 2.5 Flash: `gemini-2.5-flash-preview-05-20` → `gemini-2.5-flash`（安定版リリース）
- プレビュー版から安定版への移行により、本番環境での安定性向上

### 2025/06/14
- Gemini 2.5 Pro: `gemini-2.5-pro-preview-03-25` → `gemini-2.5-pro-preview-06-05`
- Gemini 2.5 Flash: `gemini-2.5-flash-preview-04-17` → `gemini-2.5-flash-preview-05-20`
- 最新モデルによる思考機能とパフォーマンス向上

## 参考資料

- [Google AI Studio](https://ai.google.dev/)
- [Gemini API ドキュメント](https://ai.google.dev/gemini-api/docs)
- [Gemini モデル一覧](https://ai.google.dev/gemini-api/docs/models?hl=ja)
- [LangChain Google Generative AI Integration](https://python.langchain.com/docs/integrations/chat/google_generative_ai/)
- [料金とレート制限](https://ai.google.dev/gemini-api/docs/pricing)