# トラブルシューティング

## Neo4jスキーマディレクトリの権限問題

### 問題
Neo4jコンテナが `/neo4j/schema` ディレクトリの所有権を変更してしまい、gitで追跡できなくなることがあります。

```bash
# エラー例
$ git status
warning: could not open directory 'neo4j/schema/': Permission denied
```

### 解決方法

#### 方法1: 自動修正スクリプトの実行
```bash
make fix-permissions
```

#### 方法2: 手動での権限修正
```bash
# 現在のユーザーIDとグループIDを確認
id -u  # ユーザーID
id -g  # グループID

# 権限を修正（sudoが必要な場合があります）
sudo chown -R $(id -u):$(id -g) neo4j/schema
sudo chmod -R 755 neo4j/schema
```

### 予防策

docker-compose.ymlでは以下の対策を実装しています：

1. **Read-onlyマウント**: スキーマファイルを一時ディレクトリにread-onlyでマウント
2. **起動時コピー**: コンテナ起動時にファイルをコピーして使用
3. **別ボリューム使用**: importディレクトリはDockerボリュームを使用

これにより、ホストのファイルシステムの権限が変更されることを防いでいます。

### コンテナの再起動が必要な場合

権限修正後、Neo4jコンテナを再起動する必要がある場合があります：

```bash
# Neo4jコンテナのみ再起動
docker-compose restart neo4j

# または全体を再起動
docker-compose down
docker-compose up -d
```

## その他の一般的な問題

### ポートの競合

既に使用されているポートがある場合：

```bash
# 使用中のポートを確認
lsof -i :5432  # PostgreSQL
lsof -i :7474  # Neo4j HTTP
lsof -i :7687  # Neo4j Bolt
lsof -i :8000  # Backend API
lsof -i :3000  # Frontend

# プロセスを停止
kill -9 <PID>
```

### Dockerボリュームのクリーンアップ

古いデータが残っている場合：

```bash
# 全てのボリュームを削除（注意：データが失われます）
docker-compose down -v

# 特定のボリュームのみ削除
docker volume rm logverse_neo4j_data
```

### メモリ不足

Neo4jやPostgreSQLがメモリ不足でクラッシュする場合：

1. Docker Desktopの設定でメモリ割り当てを増やす
2. docker-compose.ymlで各サービスのメモリ設定を調整

```yaml
# Neo4jの例
environment:
  NEO4J_dbms_memory_heap_max__size: 512m  # 必要に応じて調整
  NEO4J_dbms_memory_pagecache_size: 256m  # 必要に応じて調整
```