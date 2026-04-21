// Neo4j初期スキーマ設定 - ゲスタロカ
// グラフデータベースの制約とインデックスを作成

// ===========================================
// 制約の作成（Uniqueness Constraints）
// ===========================================

// ユーザーノードの制約
CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE;
CREATE CONSTRAINT user_username_unique IF NOT EXISTS FOR (u:User) REQUIRE u.username IS UNIQUE;
CREATE CONSTRAINT user_email_unique IF NOT EXISTS FOR (u:User) REQUIRE u.email IS UNIQUE;

// キャラクターノードの制約
CREATE CONSTRAINT character_id_unique IF NOT EXISTS FOR (c:Character) REQUIRE c.id IS UNIQUE;

// ロケーションノードの制約
CREATE CONSTRAINT location_id_unique IF NOT EXISTS FOR (l:Location) REQUIRE l.id IS UNIQUE;

// NPCノードの制約
CREATE CONSTRAINT npc_id_unique IF NOT EXISTS FOR (n:NPC) REQUIRE n.id IS UNIQUE;

// ログフラグメントノードの制約
CREATE CONSTRAINT log_fragment_id_unique IF NOT EXISTS FOR (lf:LogFragment) REQUIRE lf.id IS UNIQUE;

// 完成ログノードの制約
CREATE CONSTRAINT completed_log_id_unique IF NOT EXISTS FOR (cl:CompletedLog) REQUIRE cl.id IS UNIQUE;

// イベントノードの制約
CREATE CONSTRAINT event_id_unique IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE;

// ===========================================
// インデックスの作成（Performance Indexes）
// ===========================================

// ユーザー検索用インデックス
CREATE INDEX user_created_at_index IF NOT EXISTS FOR (u:User) ON (u.created_at);
CREATE INDEX user_active_index IF NOT EXISTS FOR (u:User) ON (u.is_active);

// キャラクター検索用インデックス
CREATE INDEX character_name_index IF NOT EXISTS FOR (c:Character) ON (c.name);
CREATE INDEX character_level_index IF NOT EXISTS FOR (c:Character) ON (c.level);
CREATE INDEX character_created_at_index IF NOT EXISTS FOR (c:Character) ON (c.created_at);
CREATE INDEX character_active_index IF NOT EXISTS FOR (c:Character) ON (c.is_active);

// ロケーション検索用インデックス
CREATE INDEX location_name_index IF NOT EXISTS FOR (l:Location) ON (l.name);
CREATE INDEX location_type_index IF NOT EXISTS FOR (l:Location) ON (l.type);

// NPC検索用インデックス
CREATE INDEX npc_name_index IF NOT EXISTS FOR (n:NPC) ON (n.name);
CREATE INDEX npc_type_index IF NOT EXISTS FOR (n:NPC) ON (n.type);
CREATE INDEX npc_created_at_index IF NOT EXISTS FOR (n:NPC) ON (n.created_at);

// ログフラグメント検索用インデックス
CREATE INDEX log_fragment_type_index IF NOT EXISTS FOR (lf:LogFragment) ON (lf.type);
CREATE INDEX log_fragment_quality_index IF NOT EXISTS FOR (lf:LogFragment) ON (lf.quality);
CREATE INDEX log_fragment_created_at_index IF NOT EXISTS FOR (lf:LogFragment) ON (lf.created_at);

// 完成ログ検索用インデックス
CREATE INDEX completed_log_status_index IF NOT EXISTS FOR (cl:CompletedLog) ON (cl.status);
CREATE INDEX completed_log_created_at_index IF NOT EXISTS FOR (cl:CompletedLog) ON (cl.created_at);

// イベント検索用インデックス
CREATE INDEX event_type_index IF NOT EXISTS FOR (e:Event) ON (e.type);
CREATE INDEX event_timestamp_index IF NOT EXISTS FOR (e:Event) ON (e.timestamp);

// ===========================================
// 全文検索インデックス（Full-text Search）
// ===========================================

// キャラクター情報の全文検索
CREATE FULLTEXT INDEX character_description_fulltext IF NOT EXISTS
FOR (c:Character) ON EACH [c.description, c.appearance, c.personality];

// NPC情報の全文検索
CREATE FULLTEXT INDEX npc_description_fulltext IF NOT EXISTS
FOR (n:NPC) ON EACH [n.description, n.personality, n.backstory];

// ログフラグメントの全文検索
CREATE FULLTEXT INDEX log_fragment_content_fulltext IF NOT EXISTS
FOR (lf:LogFragment) ON EACH [lf.content, lf.tags];

// 完成ログの全文検索
CREATE FULLTEXT INDEX completed_log_content_fulltext IF NOT EXISTS
FOR (cl:CompletedLog) ON EACH [cl.title, cl.summary, cl.content];

// ロケーション情報の全文検索
CREATE FULLTEXT INDEX location_description_fulltext IF NOT EXISTS
FOR (l:Location) ON EACH [l.description, l.atmosphere];

// ===========================================
// 基本的なノードラベル説明（コメント）
// ===========================================

/*
ノードラベルの定義:

- User: ユーザーアカウント
- Character: プレイヤーキャラクター
- Location: ゲーム内のロケーション
- NPC: ノンプレイヤーキャラクター（ログから生成されたものを含む）
- LogFragment: ログの欠片
- CompletedLog: 完成したログ
- Event: ゲーム内イベント
- Skill: スキル
- Item: アイテム
- Guild: ギルド
- World: 世界状態

リレーションシップタイプの例:
- OWNS: 所有関係 (User)-[OWNS]->(Character)
- LOCATED_IN: 位置関係 (Character)-[LOCATED_IN]->(Location)
- INTERACTED_WITH: 相互作用 (Character)-[INTERACTED_WITH]->(NPC)
- GENERATED_FROM: 生成関係 (NPC)-[GENERATED_FROM]->(LogFragment)
- CONTAINS: 包含関係 (CompletedLog)-[CONTAINS]->(LogFragment)
- HAPPENED_AT: 発生関係 (Event)-[HAPPENED_AT]->(Location)
- HAS_SKILL: スキル関係 (Character)-[HAS_SKILL]->(Skill)
- INFLUENCED_BY: 影響関係 (Event)-[INFLUENCED_BY]->(Character)
*/