# フォームバリデーションと文字数制限

## 概要

ゲスタロカでは、AI（Gemini 2.5 Pro）に送信されるユーザー入力に対して適切な文字数制限を設定し、UIで文字数をリアルタイムに表示します。

## 文字数制限一覧

### キャラクター作成（Character）

| フィールド | 最大文字数 | バックエンド | フロントエンド |
|-----------|-----------|------------|--------------|
| name | 50 | ✅ | ✅ |
| description | 1000 | ✅ | ✅ |
| appearance | 1000 | ✅ | ✅ |
| personality | 1000 | ✅ | ✅ |

### ゲームアクション（GameAction）

| フィールド | 最大文字数 | バックエンド | フロントエンド |
|-----------|-----------|------------|--------------|
| action_text | 500 | ✅ | - |

注：現在、フロントエンドでは事前定義された選択肢からの選択のみ。カスタムアクション入力は未実装。

### クエスト（Quest）

| フィールド | 最大文字数 | バックエンド | フロントエンド |
|-----------|-----------|------------|--------------|
| title | 100 | ✅ | ✅ |
| description | 2500 | ✅ | ✅ |

注：descriptionはAIによって動的に更新される可能性があるため、長めの制限を設定。

## 実装詳細

### バックエンド実装

#### 1. Pydanticスキーマでの制限

```python
# app/schemas/game_session.py
class GameActionRequest(BaseModel):
    action_text: str = Field(max_length=500, description="アクションテキスト（最大500文字）")
    
    @field_validator("action_text")
    @classmethod
    def validate_action_text(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("アクションテキストは必須です")
        if len(v) > 500:
            raise ValueError("アクションテキストは500文字以内で入力してください")
        return v.strip()
```

#### 2. SQLModelでの制限

```python
# app/models/quest.py
class Quest(SQLModel, table=True):
    title: str = Field(
        sa_column=Column(String(100)), 
        max_length=100, 
        description="クエストのタイトル（動的に更新可能、最大100文字）"
    )
    description: str = Field(
        sa_column=Column(String(2500)), 
        max_length=2500, 
        description="クエストの説明（動的に更新される、最大2500文字）"
    )
```

### フロントエンド実装

#### 1. 文字数カウンターコンポーネント

**CharacterCounter.tsx**
- 現在の文字数と最大文字数を表示
- 80%以上で黄色、100%で赤色に変化

**InputWithCounter.tsx / TextareaWithCounter.tsx**
- 入力フィールドと文字数カウンターを統合
- ラベルの横に文字数を表示

#### 2. 使用例

```tsx
// キャラクター作成ページ
<InputWithCounter
  id="name"
  {...register('name')}
  placeholder="例: アリア・シルバーウィンド"
  maxLength={50}
/>

<TextareaWithCounter
  id="description"
  {...register('description')}
  placeholder="キャラクターの背景や設定..."
  maxLength={1000}
/>
```

### AIプロンプトへの反映

GM AIへのプロンプトに文字数制限を明記：

```python
# クエスト提案時
"""
各クエストには以下を含めてください：
- title: 簡潔なタイトル（最大100文字）
- description: 詳細な説明（最大2500文字）
"""

# クエスト進行評価時
"""
6. updated_description: 更新された説明（オプション、最大2500文字）
"""
```

## マイグレーション

以下のAlembicマイグレーションが適用済み：
1. `cb687f3e2cde`: Questモデルのtitle/descriptionフィールドに文字数制限を追加
2. `feb673044f6d`: Quest descriptionの制限を2500文字に拡張

## 今後の拡張予定

1. **カスタムアクション入力**
   - NarrativeInterfaceにフリーテキスト入力を追加
   - 500文字制限と文字数カウンターを実装

2. **チャット機能**
   - NPCとの会話機能実装時に文字数制限を設定

3. **バリデーションルールAPI**
   - `/api/v1/config/game/validation-rules` の活用
   - フロントエンドとバックエンドの制限を同期

## 更新履歴

- 2025-07-06: 初回実装
  - バックエンド：GameActionRequest、Questモデルに文字数制限追加
  - フロントエンド：文字数カウンターコンポーネント実装
  - AIプロンプト：文字数制限を明記