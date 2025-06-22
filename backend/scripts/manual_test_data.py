#!/usr/bin/env python3
"""手動でテストデータを作成するための手順"""

print("""
=== ログ編纂機能のテスト手順 ===

1. ブラウザで http://localhost:3000 にアクセス

2. 新規ユーザー登録:
   - 「新規登録」をクリック
   - Email: test@example.com
   - Username: testuser
   - Password: testpassword123
   - 登録後、自動的にログインされます

3. キャラクター作成:
   - 「キャラクター作成」をクリック
   - 名前: テスト戦士エリス
   - 説明: 勇敢な女性戦士
   - 外見: 銀色の鎧を身にまとった戦士
   - 性格: 勇敢で正義感が強い
   - 作成ボタンをクリック

4. ログフラグメントの手動作成:
   現在、ゲームセッション中の自動生成機能がないため、
   以下のSQLを実行してテストデータを作成してください：

   docker-compose exec postgres psql -U gestaloka -d gestaloka

   -- ゲームセッション作成
   INSERT INTO game_sessions (id, character_id, is_active, current_scene, created_at, updated_at)
   VALUES (
     'test-session-001',
     (SELECT id FROM characters WHERE name = 'テスト戦士エリス' LIMIT 1),
     true,
     '冒険の始まり',
     NOW(),
     NOW()
   );

   -- ログフラグメント作成
   INSERT INTO log_fragments (id, character_id, session_id, action_description, keywords, emotional_valence, rarity, importance_score, context_data, created_at)
   VALUES 
   ('fragment-001', (SELECT id FROM characters WHERE name = 'テスト戦士エリス' LIMIT 1), 'test-session-001', 
    '荒野の獣との戦闘で巧みな戦術を用いて勝利した', '{"戦闘", "戦術", "勝利"}', 'positive', 'uncommon', 0.7, 
    '{"location": "荒野", "weather": "晴れ"}', NOW() - INTERVAL '5 days'),
   
   ('fragment-002', (SELECT id FROM characters WHERE name = 'テスト戦士エリス' LIMIT 1), 'test-session-001',
    '困っている旅人を助け、感謝の言葉を受けた', '{"善行", "助け", "感謝"}', 'positive', 'common', 0.6,
    '{"location": "街道", "weather": "曇り"}', NOW() - INTERVAL '4 days'),
   
   ('fragment-003', (SELECT id FROM characters WHERE name = 'テスト戦士エリス' LIMIT 1), 'test-session-001',
    '油断から敵の罠にかかり、重傷を負った', '{"失敗", "罠", "負傷"}', 'negative', 'common', 0.6,
    '{"location": "洞窟", "weather": "不明"}', NOW() - INTERVAL '3 days'),
   
   ('fragment-004', (SELECT id FROM characters WHERE name = 'テスト戦士エリス' LIMIT 1), 'test-session-001',
    '古代の遺跡で貴重な遺物を発見した', '{"探索", "発見", "遺跡"}', 'positive', 'rare', 0.8,
    '{"location": "遺跡", "weather": "霧"}', NOW() - INTERVAL '2 days'),
   
   ('fragment-005', (SELECT id FROM characters WHERE name = 'テスト戦士エリス' LIMIT 1), 'test-session-001',
    '静かな夜に星空を眺めて過ごした', '{"休息", "平穏", "内省"}', 'neutral', 'common', 0.3,
    '{"location": "野営地", "weather": "晴れ"}', NOW() - INTERVAL '1 day'),
   
   ('fragment-006', (SELECT id FROM characters WHERE name = 'テスト戦士エリス' LIMIT 1), 'test-session-001',
    '強大な敵に立ち向かい、仲間と協力して撃退した', '{"協力", "勇気", "友情"}', 'positive', 'rare', 0.85,
    '{"location": "砦", "weather": "嵐"}', NOW() - INTERVAL '12 hours'),
   
   ('fragment-007', (SELECT id FROM characters WHERE name = 'テスト戦士エリス' LIMIT 1), 'test-session-001',
    '古代の龍と対峙し、その知恵を授かった', '{"龍", "伝説", "知恵"}', 'positive', 'legendary', 1.0,
    '{"location": "龍の巣", "weather": "神秘的"}', NOW());

5. ログシステムのテスト:
   - http://localhost:3000/logs にアクセス
   - キャラクター「テスト戦士エリス」を選択
   - ログフラグメントが表示されることを確認
   - 複数のフラグメントを選択
   - 「ログを編纂する」ボタンをクリック
   - 編纂画面でコアフラグメントを選択
   - ログ名、称号、説明を入力
   - 「ログを編纂」ボタンをクリック

これで編纂機能のテストができます！
""")
