#!/bin/bash
# Neo4j初期化スクリプト

echo "=== Neo4j初期化開始 ==="

# Neo4jの起動を待機
echo "Neo4jの起動を待機中..."
while ! cypher-shell -u neo4j -p logverse_neo4j_password "RETURN 1" > /dev/null 2>&1; do
    echo "Neo4jの起動を待機中... (5秒後に再試行)"
    sleep 5
done

echo "✅ Neo4jが起動しました"

# スキーマファイルの実行
echo "スキーマを作成中..."
if cypher-shell -u neo4j -p logverse_neo4j_password < /var/lib/neo4j/import/01_schema.cypher; then
    echo "✅ スキーマ作成完了"
else
    echo "❌ スキーマ作成に失敗しました"
    exit 1
fi

# 初期データの作成
echo "初期データを作成中..."
if cypher-shell -u neo4j -p logverse_neo4j_password < /var/lib/neo4j/import/02_initial_data.cypher; then
    echo "✅ 初期データ作成完了"
else
    echo "❌ 初期データ作成に失敗しました"
    exit 1
fi

# 統計情報の取得
echo "データベース統計:"
cypher-shell -u neo4j -p logverse_neo4j_password "
MATCH (l:Location) WITH count(l) as locations
MATCH (n:NPC) WITH locations, count(n) as npcs  
MATCH (s:Skill) WITH locations, npcs, count(s) as skills
MATCH (w:World) WITH locations, npcs, skills, count(w) as worlds
RETURN 
  locations as ロケーション数,
  npcs as NPC数,
  skills as スキル数,
  worlds as 世界数
"

echo "=== Neo4j初期化完了 ==="
echo ""
echo "🔗 Neo4jブラウザ: http://localhost:7474"
echo "   ユーザー名: neo4j"
echo "   パスワード: logverse_neo4j_password"
echo ""
echo "📊 基本クエリ例:"
echo "   MATCH (l:Location) RETURN l"
echo "   MATCH (n:NPC) RETURN n"
echo "   MATCH (w:World) RETURN w"
echo ""