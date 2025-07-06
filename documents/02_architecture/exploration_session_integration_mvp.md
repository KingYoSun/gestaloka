# 探索機能とセッション進行の統合 - MVP版実装計画

## 概要
MVPテストプレイに向けて、探索機能をセッション進行に統合します。データ移行や後方互換性は考慮せず、理想的な実装を行います。

## 実装方針

### シンプルな統合アプローチ
1. **探索専用ページを即座に廃止**
2. **すべての探索をセッション進行内で処理**
3. **物語主導型の理想的な実装**

## 実装内容

### 1. フロントエンドの変更（1日）

#### サイドバーから探索リンクを削除
```typescript
// frontend/src/components/Navigation.tsx
// "探索"メニュー項目を削除
```

#### 探索ルートの削除
```bash
# 削除対象
frontend/src/routes/_authenticated/exploration.tsx
frontend/src/features/exploration/
```

### 2. バックエンドの統合（2-3日）

#### GameSessionService の拡張
```python
# backend/app/services/game_session.py

class GameSessionService:
    async def generate_choices(self, session_id: str) -> List[ActionChoice]:
        """物語の文脈に応じた選択肢を生成（探索を含む）"""
        
        session = await self._get_session(session_id)
        character = session.character
        context = self._build_context(session)
        
        # CoordinatorAIが探索も含めた選択肢を生成
        choices = await self.coordinator.generate_contextual_choices(
            character=character,
            location=character.location,
            context=context,
            include_exploration=True  # 探索選択肢を含める
        )
        
        return choices
    
    async def process_action(
        self,
        session_id: str,
        choice_id: str,
        user_input: str
    ) -> GameResponse:
        """すべてのアクション（探索含む）を物語として処理"""
        
        # 選択肢のメタデータから処理を分岐
        choice = await self._get_choice(choice_id)
        
        if choice.metadata.get("is_movement"):
            return await self._process_movement_as_story(
                session_id, choice, user_input
            )
        elif choice.metadata.get("is_exploration"):
            return await self._process_exploration_as_story(
                session_id, choice, user_input
            )
        else:
            # 通常の物語処理
            return await self._process_story_action(
                session_id, choice, user_input
            )
```

#### CoordinatorAI の拡張
```python
# backend/app/ai_agents/coordinator.py

class CoordinatorAI:
    async def generate_contextual_choices(
        self,
        character: Character,
        location: Location,
        context: Dict,
        include_exploration: bool = True
    ) -> List[ActionChoice]:
        """文脈に応じた選択肢を生成"""
        
        # 基本的な物語選択肢
        story_choices = await self.dramatist.generate_story_choices(context)
        
        if include_exploration:
            # 現在の物語の流れに自然に組み込める探索選択肢を追加
            exploration_choices = await self._generate_natural_exploration_choices(
                character, location, context
            )
            
            # 物語の流れを損なわないように統合
            return self._merge_choices_naturally(
                story_choices, 
                exploration_choices,
                max_choices=3
            )
        
        return story_choices
    
    async def _generate_natural_exploration_choices(
        self,
        character: Character,
        location: Location,
        context: Dict
    ) -> List[ActionChoice]:
        """物語に自然に組み込める探索選択肢を生成"""
        
        # 移動可能な場所を取得
        connections = await self._get_connections(location)
        
        # 現在の文脈に合った移動選択肢を生成
        # 例：戦闘後なら「傷を癒せる場所を探す」
        #     謎解き中なら「手がかりがありそうな場所へ向かう」
        
        prompt = f"""
        現在の状況: {context['current_scene']}
        現在地: {location.name}
        
        以下の場所への移動を、現在の物語の流れに自然に組み込んだ選択肢を生成してください：
        {[conn.to_location.name for conn in connections]}
        
        また、現在地での探索（フラグメント探し）も物語的な選択肢として含めてください。
        """
        
        return await self.dramatist.generate_choices_from_prompt(prompt)
```

### 3. 探索結果の物語化（1日）

```python
# backend/app/services/game_session.py

async def _process_exploration_as_story(
    self,
    session_id: str,
    choice: ActionChoice,
    user_input: str
) -> GameResponse:
    """探索を物語として処理"""
    
    session = await self._get_session(session_id)
    character = session.character
    
    # フラグメント発見の判定（既存のロジックを使用）
    discovery_result = await self._attempt_fragment_discovery(
        character.location
    )
    
    # 結果を物語として描写
    narrative_context = {
        "action": user_input,
        "location": character.location,
        "discovered": discovery_result.found_fragment,
        "fragment": discovery_result.fragment if discovery_result.found_fragment else None,
        "session_context": self._get_session_context(session)
    }
    
    narrative = await self.dramatist.generate_exploration_narrative(
        narrative_context
    )
    
    # SPの消費
    if discovery_result.found_fragment:
        await self.sp_service.consume_sp(
            character.user_id,
            amount=choice.metadata.get("sp_cost", 5),
            transaction_type=SPTransactionType.EXPLORATION
        )
    
    return GameResponse(
        session_id=session_id,
        narrative=narrative,
        choices=await self.generate_choices(session_id),
        discovered_fragment=discovery_result.fragment
    )
```

### 4. 既存の探索APIの扱い（0.5日）

```python
# backend/app/api/api_v1/endpoints/exploration.py

# ファイル全体を削除、またはコメントアウト
# MVPでは不要なため

# 関連するルート登録も削除
# backend/app/api/api_v1/api.py から exploration のルート登録を削除
```

## 実装スケジュール（1週間で完了）

### Day 1-2: バックエンド基本実装
- GameSessionService の拡張
- CoordinatorAI の拡張
- 基本的なテスト

### Day 3: AI プロンプトの調整
- 自然な探索選択肢の生成
- 探索結果の物語的な描写

### Day 4: フロントエンド対応
- 探索ページの削除
- ゲームセッション画面の微調整
- 探索結果の表示改善

### Day 5: 統合テストとバグ修正
- エンドツーエンドテスト
- パフォーマンス確認
- 最終調整

## テスト項目

```python
# backend/tests/integration/test_exploration_in_session.py

async def test_exploration_choices_appear_naturally():
    """探索選択肢が物語に自然に組み込まれることを確認"""
    
async def test_movement_through_story():
    """物語を通じた場所移動が機能することを確認"""
    
async def test_fragment_discovery_narrative():
    """フラグメント発見が物語として描写されることを確認"""
    
async def test_sp_consumption_in_story_exploration():
    """物語内探索でSPが正しく消費されることを確認"""
```

## 設定

```python
# backend/app/core/config.py
# 特別な設定は不要 - MVPではすべてデフォルトで有効
```

## メリット

1. **開発期間の大幅短縮**: 2-3週間 → 1週間
2. **複雑性の削減**: 移行やフィーチャーフラグが不要
3. **理想的な実装**: 最初から物語主導型で実装
4. **テストの簡略化**: 後方互換性のテストが不要

## 注意点

- 既存の探索データ（もしあれば）は考慮しない
- ユーザーは最初から新しいシステムを使用
- パフォーマンスは後から最適化

---

*最終更新: 2025-07-06*
*実装開始可能: 即座に*