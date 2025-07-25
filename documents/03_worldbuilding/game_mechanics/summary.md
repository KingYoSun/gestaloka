# ゲームメカニクス概要

最終更新: 2025-07-11

## 基本設計思想
ゲスタロカのゲームメカニクスは「プレイヤーの自由度」と「物語の動的生成」を最優先に設計されています。制限より可能性を、固定シナリオより創発的な物語を重視します。

## コアメカニクス

### ハイブリッド行動システム
- AIが状況に応じた3つの選択肢を提示
- プレイヤーは自由なテキスト入力で第4の選択肢を創造可能
- 環境オブジェクトを活用した創造的な解決策を推奨

### ログシステム
プレイヤーの行動履歴が世界に永続的な影響を与える独自システム：
- **ログフラグメント**: 重要な行動や経験が自動的に記録
  - 探索での発見
  - クエスト完了時の生成（2025-07-03実装）
  - 永続的なコレクションアイテムとして機能
- **ログ編纂**: フラグメントを組み合わせて完成ログ（NPC）を創造
- **ログ派遣**: 完成ログを独立NPCとして世界へ送り出す
- **ログ汚染**: 負の感情による変質とその浄化

### SPシステム
世界への干渉力を表すリソース：
- **用途**: 自由行動宣言、ログ派遣、探索、場所移動
- **回復**: 毎日UTC 4時（日本時間午後1時）に10SP自然回復、購入可能
- **マネタイズ**: 課金による追加SP獲得

### 探索システム
階層世界ゲスタロカを自由に探索：
- **場所移動**: SP消費で他の場所へ移動
- **エリア探索**: 場所内でログフラグメントや記憶を発見
- **危険度**: 場所により異なる危険度とSP消費量

### キャラクター成長
- **レベル**: 総合的な強さの指標（1-100）
- **素養**: 5つの基本能力値（筋力・敏捷・知性・精神・魅力）
- **技能**: 特定分野の熟練度（剣術・魔術・交渉など）
- **状態**: HP/MP、異常状態、バフ/デバフ

## システム間の相互作用

```
行動選択 → GM AI評価 → 結果生成
    ↓           ↓           ↓
ログ記録    状態更新    物語進行
    ↓           ↓           ↓
世界への影響  成長判定    新展開生成
```

## 設計上の重要事項

1. **失敗も物語**: 失敗や予期せぬ結果も面白い展開として扱う
2. **創造性重視**: プレイヤーの創造的な解決策を積極的に評価
3. **永続的影響**: すべての行動が何らかの形で世界に残る
4. **バランスより体験**: 完璧なバランスより印象的な体験を優先

詳細は各ドキュメントを参照：
- [basic.md](basic.md) - 基本メカニクスの詳細
- [log.md](log.md) - ログシステムの詳細
- [memoryFragmentAcquisition.md](memoryFragmentAcquisition.md) - 記憶フラグメント獲得システム
- [memoryInheritance.md](memoryInheritance.md) - 記憶継承システム
- [logDispatchSystem.md](logDispatchSystem.md) - ログ派遣システムの詳細
- [advancedCompilation.md](advancedCompilation.md) - 高度な編纂メカニクス
- [purificationSystem.md](purificationSystem.md) - 汚染浄化システム
- [spSystem.md](spSystem.md) - SPシステムの詳細
- [explorationSystem.md](explorationSystem.md) - 物語内探索システム
- [titleSystem.md](titleSystem.md) - 称号システム