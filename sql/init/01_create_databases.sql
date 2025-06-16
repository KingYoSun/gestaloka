-- PostgreSQL初期化スクリプト
-- ログバース用データベースとKeycloak用データベースを作成

-- Logverse用データベース（既にdocker-compose.ymlで作成されるが、念のため）
-- CREATE DATABASE logverse;
-- CREATE USER logverse_user WITH PASSWORD 'logverse_password';
-- GRANT ALL PRIVILEGES ON DATABASE logverse TO logverse_user;

-- Keycloak用データベース（既にdocker-compose.ymlで作成されるが、念のため）
-- CREATE DATABASE keycloak;
-- CREATE USER keycloak_user WITH PASSWORD 'keycloak_password';
-- GRANT ALL PRIVILEGES ON DATABASE keycloak TO keycloak_user;

-- PostgreSQL拡張機能を有効化
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Logverseデータベースに接続して追加設定
\c logverse;

-- UUIDとタイムスタンプ関数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 全文検索用の設定（日本語対応）
-- 注意: 実際の本番環境では適切な日本語全文検索エンジンの設定が必要
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- インデックス作成関数（後でテーブル作成後に使用）
CREATE OR REPLACE FUNCTION create_logverse_indexes()
RETURNS void AS $$
BEGIN
    -- ユーザーテーブルのインデックス
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_username ON users USING btree (username);
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users USING btree (email);
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_active ON users USING btree (is_active);
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at ON users USING btree (created_at);
    END IF;

    -- キャラクターテーブルのインデックス
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'characters') THEN
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_characters_user_id ON characters USING btree (user_id);
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_characters_name ON characters USING btree (name);
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_characters_location ON characters USING btree (location);
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_characters_active ON characters USING btree (is_active);
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_characters_created_at ON characters USING btree (created_at);
        
        -- 全文検索用インデックス
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_characters_description_fulltext ON characters USING gin (to_tsvector('english', description));
    END IF;

    -- ゲームセッションテーブルのインデックス
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'game_sessions') THEN
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_sessions_character_id ON game_sessions USING btree (character_id);
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_sessions_active ON game_sessions USING btree (is_active);
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_sessions_created_at ON game_sessions USING btree (created_at);
    END IF;

    -- スキルテーブルのインデックス
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'skills') THEN
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_skills_character_id ON skills USING btree (character_id);
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_skills_name ON skills USING btree (name);
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_skills_level ON skills USING btree (level);
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_skills_active ON skills USING btree (is_active);
    END IF;
END;
$$ LANGUAGE plpgsql;