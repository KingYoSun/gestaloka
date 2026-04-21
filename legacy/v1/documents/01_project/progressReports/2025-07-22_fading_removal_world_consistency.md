# フェイディング設定削除と世界観の整合性改善

日付: 2025-07-22
作業者: Claude

## 概要
世界設定における「フェイディング」は、システム上の必要性が薄い上に世界観を必要以上にダークにしていたため、削除を実施。「世界の消滅」や「世界の劣化」の要素は既に「汚染と浄化」で担っているため、重複する概念を統合し、世界観の整合性を改善した。

## 作業内容

### 1. 世界観ドキュメントの更新（documents/03_worldbuilding）

#### world_design.md
- **機憶教団**: フェイディングによる世界の崩壊 → 汚染と歪みの浄化活動に変更
- **リターナーズ**: 汚染も設計者の摂理として受け入れ、浄化に反対する設定に修正
- **世界の脅威**: 「緩やかな消滅『フェイディング』」→「世界の劣化と汚染」に変更
- **来訪者の使命**: 世界の消滅 → 世界の劣化への対応に変更

#### game_mechanics/logDispatchSystem.md
- 記憶保存型（MEMORY_PRESERVE）: フェイディングから記憶を守る → 世界の劣化から記憶を守る
- フェイディング進行度 → 劣化進行度に変更

#### game_mechanics/memoryFragmentAcquisition.md
- アーキテクト記憶: フェイディングの真相 → 世界の劣化と汚染の真相

#### summary.md
- 世界観テーマ: 『フェイディング』→ 世界の劣化と汚染 - 浄化による世界の再生

### 2. AI仕様ドキュメントの更新（documents/04_ai_agents）

#### gm_ai_spec/dramatist.md
- 世界は「フェイディング」により存在が薄れつつある → 「汚染」や「劣化」により各地が侵食されつつある
- フェイディング現象の影響を適切に表現 → 汚染と劣化の影響を適切に表現

#### gm_ai_spec/the_world.md
- 汚染度: フェイディングや邪悪な力 → 歪みや邪悪な力による世界の汚染レベル

### 3. バックエンド実装の更新

#### app/tasks/dispatch_tasks.py
- `fading_delayed` → `degradation_delayed` に変更

#### app/models/log_dispatch.py
- 記憶保存型のコメント: フェイディングから記憶を守る → 世界の劣化から記憶を守る

#### app/services/log_fragment_service.py
- アーキテクトキーワード: 「フェイディング」→「世界の劣化」
- 世界の真実パターン: 世界が徐々に情報として消失 → 世界が汚染と歪みにより侵食

#### app/services/ai/prompt_manager.py
- dramatistプロンプト: 世界は「フェイディング」により → 世界は「汚染」や「劣化」により

### 4. データベーススキーマの更新

#### neo4j/schema/02_initial_data.cypher
- WorldState: `fading_level` → `contamination_level` に変更

## 変更の影響

### 世界観の統一
- 「汚染」と「浄化」を中心とした一貫性のある世界観に統一
- 重複していた概念（フェイディングと汚染）を整理

### ゲームメカニクスへの影響
- 既存の汚染浄化システム（purificationSystem.md）がより重要な役割を担う
- 記憶保存活動が世界の劣化対策として明確に位置づけられた

### AI動作への影響
- GM AIが生成する物語で「汚染」「劣化」「浄化」がより統一的に扱われる
- プレイヤーの目的がより明確になる（世界の浄化と再生）

## 今後の推奨事項

1. **汚染浄化システムの拡充**
   - purificationSystem.mdに基づいた具体的な実装強化
   - 浄化アイテムや浄化スキルの追加

2. **世界の劣化メカニクス**
   - 時間経過による自然劣化の実装
   - プレイヤー活動による劣化の抑制効果

3. **リターナーズとの対立**
   - 浄化活動を妨害するイベント
   - 思想的な対立を表現するクエスト

## 関連ファイル
- documents/03_worldbuilding/world_design.md
- documents/03_worldbuilding/game_mechanics/logDispatchSystem.md
- documents/03_worldbuilding/game_mechanics/memoryFragmentAcquisition.md
- documents/03_worldbuilding/summary.md
- documents/04_ai_agents/gm_ai_spec/dramatist.md
- documents/04_ai_agents/gm_ai_spec/the_world.md
- backend/app/tasks/dispatch_tasks.py
- backend/app/models/log_dispatch.py
- backend/app/services/log_fragment_service.py
- backend/app/services/ai/prompt_manager.py
- neo4j/schema/02_initial_data.cypher