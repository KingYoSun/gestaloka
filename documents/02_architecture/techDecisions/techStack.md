# 技術スタック - ゲスタロカ (Gestaloka)

このファイルには、技術スタックの選定理由、比較検討した代替案、実装詳細が記載されています。

## フロントエンド

### TypeScript + React 18
**選定理由:**
- 型安全性による大規模開発での保守性
- 豊富なエコシステムとコミュニティサポート
- リアルタイムUIの更新に優れた仮想DOM
- Concurrent Features（React 18）によるパフォーマンス向上

**実装構成:** ✅ **実装済み**
- React 19.1.0 + TypeScript 5.8.3
- 完全な型安全性確保（strict mode）
- パスマッピング設定（@/* エイリアス）

**考慮した代替案:**
- Vue.js: 学習曲線は緩やかだが、TypeScriptサポートが後発
- Svelte: パフォーマンスは優秀だが、エコシステムが未成熟

### Vite 6.3.5
**選定理由:**
- 高速な開発サーバー起動（ESBuildベース）
- HMR（Hot Module Replacement）の優れた体験
- プロダクションビルドの最適化

**実装構成:** ✅ **実装済み**
- Vite設定ファイル完成（vite.config.ts）
- パスリゾルバー設定（@エイリアス）
- テスト環境統合（Vitest）

### UI層: shadcn/ui + TailwindCSS
**選定理由:**
- コンポーネントのソースコードを直接管理できる
- Tailwind CSSとの優れた統合
- カスタマイズの自由度が高い
- アクセシビリティ対応（Radix UI基盤）

**実装構成:** ✅ **実装済み**
- TailwindCSS 4.1.10設定完了（v4新形式対応）
- 基本UIコンポーネント（Button, Input）実装
- ダークモード対応設定
- レスポンシブデザイン設定

**実装パターン:**
```typescript
// コンポーネントは直接プロジェクトに含まれる
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils" // className結合ユーティリティ
```

### 状態管理: Zustand + TanStack Query
**選定理由:**
- Zustand: Reduxより軽量、TypeScript優秀
- TanStack Query: サーバー状態管理の最適化
- DevToolsサポート

**実装構成:** ✅ **実装済み**
- TanStack Query 5.80.7設定完了
- エラーハンドリング・リトライロジック
- キャッシュ戦略設定（5分/10分）

### ルーティング: TanStack Router
**選定理由:**
- TanStack Queryとの完全統合
- 型安全なルーティング（Type-safe routing）
- ファイルベースルーティング
- 優れたDevTools体験

**実装構成:** ✅ **実装済み**
- TanStack Router 1.121.12導入完了
- ファイルベースルート定義（`/src/routes/`）
- 型安全なナビゲーション実装
- 認証ガード統合

**実装パターン:**
```typescript
// TanStack Router - ルート定義例
import { createFileRoute } from '@tanstack/react-router'
import { DashboardPage } from '@/features/dashboard/DashboardPage'

export const Route = createFileRoute('/dashboard')({
  component: () => (
    <ProtectedRoute>
      <Layout>
        <DashboardPage />
      </Layout>
    </ProtectedRoute>
  ),
})

// 型安全なナビゲーション
const navigate = useNavigate()
navigate({ to: '/dashboard' }) // 型チェック済み

// TanStack Query例
const { data: characters } = useQuery({
  queryKey: ['characters', userId],
  queryFn: () => fetchCharacters(userId),
})
```
```typescript
// ストアの定義
interface GameStore {
  player: Player | null
  setPlayer: (player: Player) => void
}

const useGameStore = create<GameStore>((set) => ({
  player: null,
  setPlayer: (player) => set({ player }),
}))
```

## バックエンド

### Python 3.11 + FastAPI 0.104.1
**選定理由:**
- LangChain/LLMエコシステムとの親和性
- 自動的なOpenAPI仕様生成
- 非同期処理のネイティブサポート
- Pydanticによる型安全性

**実装構成:** ✅ **実装済み**
- FastAPI + SQLModel + Pydantic統合
- 完全な型安全性（mypy準拠）
- 非同期エンドポイント実装
- 自動API文書化（Swagger UI）
- 構造化ログ（structlog）統合
- ゲームセッション管理API実装済み

**実装パターン:**
```python
# 非同期エンドポイントの実装済み例
@router.post("/characters/", response_model=Character)
async def create_character(
    character_data: CharacterCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session)
) -> Any:
    character_service = CharacterService(db)
    character = await character_service.create(current_user.id, character_data)
    return character

# ゲームセッション実装パターン（新規追加）
@router.post("/sessions", response_model=GameSessionResponse)
async def create_game_session(
    session_data: GameSessionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session)
) -> GameSessionResponse:
    service = GameSessionService(db)
    return service.create_session(current_user.id, session_data)
```

### LangChain + Gemini 2.5 Pro
**選定理由:**
- プロンプト管理の抽象化
- メモリ管理機能
- 複数のLLMプロバイダーへの対応
- エージェント実装のフレームワーク
- 最新の思考機能（Thinking）対応

**実装構成:** ✅ **実装済み**
- LangChain 0.0.350 + langchain-google-genai 0.0.11 統合完了
- Gemini 2.5 Pro 最新版（gemini-2.5-pro-preview-06-05）導入
- GeminiClient クラスによる統合実装
- プロンプトテンプレート管理システム（PromptManager）
- GM AI評議会基盤（BaseAgent）と脚本家AI（Dramatist）実装
- エラーハンドリング、リトライ機構、レート制限対応
- Celeryタスクキューでの非同期AI処理準備

**モデルバージョン履歴:**
- 2025/06/14: gemini-2.5-pro-preview-03-25 → gemini-2.5-pro-preview-06-05 更新

**実装パターン（準備済み）:**
```python
# GM AI実装の基本構造（tasks/ai_tasks.py）- 実装済み
@celery_app.task(bind=True)
def generate_story_response(self, session_id: str, player_action: str, context: dict):
    # Celeryタスクファイル実装済み（app/tasks/__init__.py）
    # GM AI評議会による物語生成の次段階実装準備完了
    response = {
        "message": f"あなたの行動「{player_action}」に対する物語応答",
        "choices": [...]
    }
    return response
```

## データベース

### PostgreSQL 17（構造化データ）
**選定理由:**
- ACID特性による信頼性
- JSON型によるスキーマ柔軟性
- 成熟したエコシステム
- 優れたパフォーマンス
- 最新版での改善されたパフォーマンスとセキュリティ

**実装構成:** ✅ **実装済み**
- PostgreSQL 17-alpine Docker統合（最新安定版）
- SQLModel（Pydantic + SQLAlchemy）ORM
- Alembicマイグレーション設定
- 全文検索拡張（pg_trgm）
- 自動インデックス作成機能

**実装詳細:**
```sql
-- 実装済み拡張機能
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 自動updated_at更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';
```

**スキーマ設計の方針:**
```sql
-- イベントソーシング用テーブル
CREATE TABLE game_events (
    event_id UUID PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    player_id UUID NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    resulting_changes JSONB
);

-- インデックス戦略
CREATE INDEX idx_events_player_timestamp 
ON game_events(player_id, timestamp DESC);
```

### Neo4j 5.26 LTS（グラフデータ）
**選定理由:**
- 関係性の直感的な表現
- 複雑なクエリの高速実行
- Cypherクエリ言語の表現力
- LTSバージョンによる長期サポート

**実装構成:** ✅ **実装済み**
- Neo4j 5.26-community Docker統合（LTSバージョン）
- 完全なスキーマ設計（制約・インデックス）
- 初期データ投入（ロケーション、NPC、スキル）
- 全文検索インデックス設定

**実装詳細:**
```cypher
-- 実装済み制約
CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE;
CREATE CONSTRAINT character_id_unique IF NOT EXISTS FOR (c:Character) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT location_id_unique IF NOT EXISTS FOR (l:Location) REQUIRE l.id IS UNIQUE;

-- 実装済み全文検索インデックス
CREATE FULLTEXT INDEX character_description_fulltext IF NOT EXISTS
FOR (c:Character) ON EACH [c.description, c.appearance, c.personality];
```

**初期データ:** ✅ **投入済み**
- 4つのロケーション（始まりの村、森、遺跡、洞窟）
- 2つの基本NPC（案内人、森の番人）
- 4つの基本スキル（探索、交流、知識、直感）
- 世界状態ノード（ゲスタロカ）

## インフラストラクチャ

### Docker Compose 統合環境
**選定理由:**
- 開発環境の一貫性
- マイクロサービス化への対応
- CI/CDとの統合容易性

**実装構成:** ✅ **実装済み**
- 7サービス統合環境（フロント、バック、DB×3、認証、監視）
- ヘルスチェック設定済み
- ボリューム・ネットワーク最適化
- 開発・本番両対応設定

**サービス構成:**
```yaml
services:
  frontend:     # React/TypeScript (port 3000)
  backend:      # FastAPI/Python (port 8000)
  postgres:     # PostgreSQL 17 (port 5432)
  neo4j:        # Neo4j 5.26 LTS (port 7474/7687)
  redis:        # Redis 8 (port 6379)
  keycloak:     # Keycloak 26 LTS (port 8080)
  celery-*:     # Celery Worker/Beat/Flower
```

### Keycloak 26 認証統合
**選定理由:**
- エンタープライズグレード認証
- OIDC/SAML対応
- 細かな権限管理
- 統合管理画面
- 最新LTSバージョンによる安定性

**実装構成:** ✅ **実装済み**
- Keycloak 26 Docker統合（最新LTS）
- Gestalokaレルム設定済み
- フロントエンド・バックエンドクライアント設定
- JWT統合準備完了
- ヘルスチェック設定最適化済み

### Redis 8 + Celery 非同期処理
**選定理由:**
- 高速なインメモリキャッシュ
- Celeryメッセージブローカー
- セッション管理
- リアルタイム機能サポート
- Redis 8の改善されたパフォーマンスとセキュリティ

**実装構成:** ✅ **実装済み**
- Redis 8-alpine Docker統合（最新安定版）
- Celery Worker/Beat/Flower設定済み
- AI処理タスクキュー準備完了
- 監視ダッシュボード（Flower）統合
- Pub/Sub機能
- Celeryのメッセージブローカー
- Celeryタスクファイル実装（app/tasks/__init__.py）

**使用パターン:**
```python
# キャッシュ戦略
@cache(ttl=300)  # 5分間キャッシュ
async def get_player_stats(player_id: str):
    # 重い計算やDB查询
    pass

# リアルタイム通信
async def publish_game_event(event: GameEvent):
    await redis.publish(f"player:{event.player_id}", event.json())
```