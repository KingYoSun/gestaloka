-- Keycloak用のデータベースとユーザーを作成
-- このスクリプトはkeycloak-dbコンテナで実行される

-- Keycloak用ユーザーの作成（既に存在する場合はスキップ）
DO
$do$
BEGIN
   IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles
      WHERE  rolname = 'keycloak_user') THEN

      CREATE USER keycloak_user WITH PASSWORD 'keycloak_password';
   END IF;
END
$do$;

-- Keycloak用データベースの作成（既に存在する場合はスキップ）
SELECT 'CREATE DATABASE keycloak'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')\gexec

-- 権限の付与
GRANT ALL PRIVILEGES ON DATABASE keycloak TO keycloak_user;

-- keycloakデータベースに接続
\c keycloak;

-- 拡張機能の有効化
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- keycloak_userに全権限を付与
GRANT ALL ON SCHEMA public TO keycloak_user;