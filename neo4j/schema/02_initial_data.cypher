// Neo4j初期データ作成 - ゲスタロカ
// 基本的な世界構造とロケーションを作成

// ===========================================
// 基本ロケーションの作成
// ===========================================

// 開始村
CREATE (starting_village:Location {
  id: 'starting_village',
  name: '始まりの村',
  type: 'settlement',
  description: 'ゲスタロカの最上層にある小さな村。多くの冒険者がここから旅立つ。',
  atmosphere: 'peaceful',
  max_capacity: 100,
  current_population: 0,
  safety_level: 10,
  resource_availability: 8,
  created_at: datetime(),
  metadata: {
    climate: 'temperate',
    terrain: 'plains',
    notable_features: ['fountain', 'inn', 'general_store', 'training_ground']
  }
});

// 森の入り口
CREATE (forest_entrance:Location {
  id: 'forest_entrance',
  name: '深緑の森・入り口',
  type: 'wilderness',
  description: 'ゲスタロカの深層へと続く森の入り口。神秘的な霧に包まれている。',
  atmosphere: 'mysterious',
  max_capacity: 50,
  current_population: 0,
  safety_level: 6,
  resource_availability: 7,
  created_at: datetime(),
  metadata: {
    climate: 'humid',
    terrain: 'forest',
    notable_features: ['ancient_trees', 'winding_paths', 'mystical_fog']
  }
});

// 古の遺跡
CREATE (ancient_ruins:Location {
  id: 'ancient_ruins',
  name: '失われた遺跡',
  type: 'dungeon',
  description: 'ゲスタロカの中層にある古代文明の遺跡。多くの謎に満ちている。',
  atmosphere: 'ominous',
  max_capacity: 20,
  current_population: 0,
  safety_level: 3,
  resource_availability: 9,
  created_at: datetime(),
  metadata: {
    climate: 'cold',
    terrain: 'stone',
    notable_features: ['crumbling_walls', 'hidden_chambers', 'ancient_inscriptions']
  }
});

// 深淵の洞窟
CREATE (abyss_cave:Location {
  id: 'abyss_cave',
  name: '深淵の洞窟',
  type: 'danger_zone',
  description: 'ゲスタロカの最深層に向かう洞窟。闇が深く、危険が潜んでいる。',
  atmosphere: 'threatening',
  max_capacity: 10,
  current_population: 0,
  safety_level: 1,
  resource_availability: 10,
  created_at: datetime(),
  metadata: {
    climate: 'freezing',
    terrain: 'cavern',
    notable_features: ['endless_darkness', 'strange_echoes', 'glowing_crystals']
  }
});

// ===========================================
// ロケーション間の接続関係
// ===========================================

// 始まりの村から森の入り口へ
CREATE (starting_village)-[:CONNECTS_TO {
  direction: 'south',
  distance: 5,
  travel_time: 30,
  difficulty: 1,
  description: '平坦な道のり'
}]->(forest_entrance);

// 森の入り口から始まりの村へ（双方向）
CREATE (forest_entrance)-[:CONNECTS_TO {
  direction: 'north',
  distance: 5,
  travel_time: 30,
  difficulty: 1,
  description: '平坦な道のり'
}]->(starting_village);

// 森の入り口から古の遺跡へ
CREATE (forest_entrance)-[:CONNECTS_TO {
  direction: 'deep',
  distance: 15,
  travel_time: 120,
  difficulty: 4,
  description: '森の奥深くへの険しい道'
}]->(ancient_ruins);

// 古の遺跡から深淵の洞窟へ
CREATE (ancient_ruins)-[:CONNECTS_TO {
  direction: 'down',
  distance: 25,
  travel_time: 180,
  difficulty: 8,
  description: '危険に満ちた下層への道'
}]->(abyss_cave);

// ===========================================
// 基本NPCの作成
// ===========================================

// 村の案内人
CREATE (guide_npc:NPC {
  id: 'village_guide_001',
  name: 'エリン',
  type: 'permanent',
  role: 'guide',
  personality: 'friendly and helpful',
  appearance: '中年の女性、親しみやすい笑顔',
  backstory: '村で生まれ育ち、多くの冒険者を見送ってきた',
  dialogue_patterns: ['冒険の準備はできましたか？', 'この村のことなら何でも聞いてください', '安全な旅を！'],
  location_id: 'starting_village',
  is_active: true,
  created_at: datetime(),
  metadata: {
    disposition: 'neutral_good',
    occupation: 'village_guide',
    special_knowledge: ['local_geography', 'basic_survival_tips']
  }
});

// 森の番人
CREATE (forest_guardian:NPC {
  id: 'forest_guardian_001',
  name: '古樹の番人',
  type: 'permanent',
  role: 'guardian',
  personality: 'wise and protective',
  appearance: '木の精霊のような存在、古い樹木と一体化している',
  backstory: '森を守り続けてきた古い精霊',
  dialogue_patterns: ['森に敬意を払いなさい', '自然の声を聞きなさい', '深層への道は危険です'],
  location_id: 'forest_entrance',
  is_active: true,
  created_at: datetime(),
  metadata: {
    disposition: 'true_neutral',
    occupation: 'forest_protector',
    special_knowledge: ['forest_secrets', 'nature_magic', 'deep_layer_warnings']
  }
});

// ===========================================
// NPCとロケーションの関係
// ===========================================

CREATE (guide_npc)-[:LOCATED_IN]->(starting_village);
CREATE (forest_guardian)-[:LOCATED_IN]->(forest_entrance);

// NPCがロケーションを守護する関係
CREATE (guide_npc)-[:PROTECTS]->(starting_village);
CREATE (forest_guardian)-[:PROTECTS]->(forest_entrance);

// ===========================================
// 基本的な世界状態ノード
// ===========================================

CREATE (world_state:World {
  id: 'raish_world_001',
  name: 'ゲスタロカ',
  current_layer: 1,
  total_layers: 7,
  global_events_active: 0,
  player_count: 0,
  npc_count: 2,
  active_sessions: 0,
  world_time: datetime(),
  fading_level: 0.1,
  metadata: {
    creation_date: datetime(),
    last_major_event: null,
    active_phenomena: [],
    global_modifiers: {}
  }
});

// 世界とロケーションの関係
CREATE (world_state)-[:CONTAINS]->(starting_village);
CREATE (world_state)-[:CONTAINS]->(forest_entrance);
CREATE (world_state)-[:CONTAINS]->(ancient_ruins);
CREATE (world_state)-[:CONTAINS]->(abyss_cave);

// ===========================================
// 基本スキルテンプレートの作成
// ===========================================

CREATE (skill_exploration:Skill {
  id: 'skill_exploration',
  name: '探索',
  category: 'general',
  description: '新しい場所を発見し、隠された秘密を見つける能力',
  max_level: 100,
  base_experience_required: 100,
  created_at: datetime()
});

CREATE (skill_interaction:Skill {
  id: 'skill_interaction',
  name: '交流',
  category: 'social',
  description: 'NPCや他のプレイヤーとの関係を築く能力',
  max_level: 100,
  base_experience_required: 100,
  created_at: datetime()
});

CREATE (skill_knowledge:Skill {
  id: 'skill_knowledge',
  name: '知識',
  category: 'mental',
  description: '世界の謎を解き明かし、古代の知恵を理解する能力',
  max_level: 100,
  base_experience_required: 100,
  created_at: datetime()
});

CREATE (skill_intuition:Skill {
  id: 'skill_intuition',
  name: '直感',
  category: 'spiritual',
  description: '見えないものを感じ取り、運命を読み取る能力',
  max_level: 100,
  base_experience_required: 100,
  created_at: datetime()
});

// ===========================================
// 初期化完了のマーカー
// ===========================================

CREATE (init_marker:SystemNode {
  id: 'neo4j_init_complete',
  type: 'initialization',
  timestamp: datetime(),
  version: '1.0.0',
  description: 'Neo4j初期化完了マーカー'
});

// 統計情報の更新
MATCH (l:Location)
WITH count(l) as location_count
MATCH (n:NPC)
WITH location_count, count(n) as npc_count
MATCH (s:Skill)
WITH location_count, npc_count, count(s) as skill_count
MATCH (w:World {id: 'raish_world_001'})
SET w.location_count = location_count,
    w.npc_count = npc_count,
    w.skill_count = skill_count,
    w.last_updated = datetime();

// 初期化ログ出力用のクエリ（実行時にコメントアウト解除）
// RETURN 'Neo4j初期化完了' as status,
//        location_count,
//        npc_count,
//        skill_count;