# GESTALOKA v2 Shared World Core 計画

最終更新: 2026-04-27

## 1. エグゼクティブサマリ

GESTALOKA v2 の engine pivot は完了済みである。完了済みの旧計画は
`documents/archive/rebuild_plan_v2_completed_engine_pivot_2026-04-27.md` に退避した。

この文書は、今後の現行計画として **Shared World Core** を定義する。

Shared World Core の目的は、特定世界観に密結合したシナリオ実装ではなく、**あるプレイヤーの行動が
同一 `world_id` 内の世界状態・勢力・NPC の記憶と関係性・歴史へ影響し、その変化が他プレイヤーの
体験へ還流する汎用テキスト MMO エンジン**を作ることである。

`legacy/v1/documents/03_worldbuilding` は、実現したい世界観の規模感を確認するための参考資料として扱う。
ただし、v1 のコード、スキーマ、ログ NPC 生成、ログ派遣、dispatch 語彙は v2 へ持ち込まない。

## 2. 固定済み前提

| 項目 | v2 の固定前提 | 備考 |
|---|---|---|
| 世界モデル | プレイヤー/NPC/イベント/記憶は同一 `world_id` 名前空間に属する | cross-world は禁止 |
| 正本 | PostgreSQL + pgvector | 主要状態、イベント、記憶、SP、監査の正本 |
| グラフ | NebulaGraph は投影ストア | outbox 経由で再構築可能にする |
| 認証境界 | OIDC adapter 境界の内側に閉じ込める | domain module から Keycloak 直接依存を作らない |
| プロンプト | `prompts/` で管理 | Python/TypeScript 直書きは禁止 |
| world pack | 宣言型のみ | 任意コード、任意 hook、任意 prompt schema は認めない |
| SP | execution budget ledger | 世界内通貨、移動力、クエスト進行力として使わない |
| legacy | `legacy/v1/` は凍結済み参考資料 | import / copy-forward しない |

## 3. 目標像

v1 世界観の規模感は、階層世界、都市、企業、教団、危険領域、汚染や浄化、称号、評判、探索、歴史化が
並走するシェアワールドである。v2 では、その世界観固有の語彙を engine に埋め込まず、以下の汎用能力として
再構成する。

- プレイヤー行動が、ローカルな turn 結果で終わらず、共有世界状態へ投影される。
- 共有世界状態は、勢力、場所、NPC、噂、歴史、称号候補として蓄積される。
- 蓄積された変化は、別プレイヤーの session state、retrieval、prompt context、choice generation、
  ambient NPC behavior に反映される。
- pack は、engine の抽象語彙を世界観固有の意味へ写像する。

## 4. engine と pack の責務

| 層 | 責務 |
|---|---|
| engine core | shared consequence projection、public world state、faction state、NPC memory、relationship、history canonization、title recognition、retrieval、prompt context、same-world invariant、projection、verification |
| world pack | 階層世界、都市、地域、勢力、危険領域、汚染や浄化に相当する世界軸、称号、世界観語彙、threshold、prompt overlay、starter content |

engine 側の行動語彙は、世界観から独立した抽象タグとして扱う。

- `help`
- `harm`
- `investigate`
- `trade`
- `negotiate`
- `protect`
- `explore`
- `restore`
- `destabilize`
- `none`

pack はこれらを、例えば「浄化」「企業支援」「記憶保存」「歪みの拡大」「公共信頼の上昇」のような
世界観固有の変化へ写像する。

## 5. pack contract 拡張方針

現在の pack contract は opening slice に寄っており、`starter_location`、`lore_location`、
`followup_location`、starter/followup quest、formal/undercurrent branch を中心にしている。
Shared World Core では、これを以下の宣言へ拡張する。

### 5.1 `world_axes`

共有世界の public state meter を定義する。

例:

- 安定度
- 汚染度
- 治安
- 資源不足
- 公共信頼
- 忘却進行

各 axis は、初期値、範囲、表示名、pack 固有説明、threshold、session context への露出方針を持つ。

### 5.2 `factions`

複数勢力を定義する。

各 faction は、方針、影響範囲、初期 standing、勢力間関係、world_axes への関心、NPC や location との
紐付きを持つ。

### 5.3 `locations`

location 定義を opening slice 用の最低限から、共有世界用の地理・社会状態へ拡張する。

各 location は、階層、地域、種類、危険度、施設、公開状態、発見条件、関連 faction、関連 world_axes、
local rumor surface を持つ。

### 5.4 `npc_memory_policy`

NPC が何を記憶し、どの程度 session context へ露出するかを定義する。

対象:

- プレイヤーとの直接 interaction
- 同じ location で起きた public event
- faction に関わる event
- history に昇格した event
- NPC 自身の関係性変化

### 5.5 `history_rules`

出来事がどの段階で歴史化されるかを定義する。

段階:

- local rumor
- regional record
- faction record
- world canon

history に昇格した event は、他プレイヤーの session context、admin timeline、world memory retrieval、
title recognition に利用される。

### 5.6 `title_rules`

世界がプレイヤーの行動を承認する条件を定義する。

title は、単なる装飾ではなく、NPC 反応、faction standing、prompt context、限定 choice の条件として
扱えるようにする。ただし初期実装では数値戦闘力や課金力には接続しない。

### 5.7 `consequence_rules`

engine の抽象 action tag と outcome を、pack 固有の世界変化へ写像する。

対象:

- world_axes delta
- faction standing / influence delta
- location public state delta
- NPC memory draft
- relationship delta
- rumor draft
- history candidate
- title progress

## 6. session への還流

Shared World Core の session state は、現在の player-local state に加えて、他プレイヤー由来の共有状態を
含む。

- 周辺の噂
- 最近の local / regional / world history
- faction pressure
- location public state
- world_axes snapshot
- NPC が覚えている関連出来事
- 他プレイヤー行動由来の memory retrieval hit

これにより、プレイヤーは同じ世界で起きた変化を、説明的なニュース画面ではなく、通常の物語・NPC 反応・
選択肢・場所の雰囲気として受け取る。

## 7. ロードマップ

### Phase 1: plan refresh

状態: 完了

- 完了済み engine pivot plan を archive する。
- `rebuild_plan_v2.md` を Shared World Core の現行計画へ差し替える。
- v1 worldbuilding は規模感参照、v1 実装は持ち込まないことを明記する。

完了条件:

- archive ファイルが存在する。
- root の `rebuild_plan_v2.md` が Shared World Core 計画になっている。
- `make check-legacy` と `make scan-v1-terms` が通る。

### Phase 2: shared-world pack schema

状態: 完了

- `world_axes`、multi-faction、拡張 location、NPC memory policy、history rules、title rules、
  consequence rules を pack contract に追加する。
- 既存 bundled pack は互換を維持しつつ、最低限の shared-world section を追加する。
- pack validation は、参照整合性、threshold、action tag、location/faction/NPC 参照を検証する。

完了条件:

- opening slice 以外の共有世界状態を pack で宣言できる。
- `make pack-validate` が新 contract を検証する。
- 既存 pack regression が green のまま残る。

### Phase 3: shared consequence projection

状態: 完了

- turn resolution の結果から abstract action tag と consequence signal を抽出する。
- pack の consequence rules に従い、world_axes、faction state、location public state、NPC memory、
  relationship、history candidate へ投影する。
- 投影結果は PostgreSQL を正本とし、NebulaGraph は outbox 経由で再構築可能な投影に留める。

完了条件:

- 同一 `world_id` 内の別 actor の行動が、共有 state として永続化される。
- cross-world 参照が発生しない。
- 失敗時に turn 自体と projection retry の境界が明確である。

### Phase 4: cross-player feedback loop

状態: 完了

- 共有 state を session state、retrieval query、prompt context、choice generation、ambient NPC behavior、
  rumor surface に反映する。
- 別プレイヤー由来の変化は、過剰に説明せず、場所の空気、NPC の記憶、噂、歴史断片として提示する。
- session payload と admin surface は、共有 state の由来を追跡できる trace を持つ。

完了条件:

- player A の行動が、player B の session context に意味のある形で現れる regression が存在する。
- 共有 state が prompt context に入り、LLM 監査ログで確認できる。
- world_id invariant と pack context が全 payload で維持される。

### Phase 5: history canonization and titles

状態: 完了

- history candidate を local rumor、regional record、faction record、world canon へ昇格する。
- title rules により、プレイヤーの行動パターンや偉業を称号候補として蓄積する。
- title は初期段階では narrative recognition と NPC 反応の文脈として扱う。

完了条件:

- world canon に昇格した出来事が、他 session の retrieval と admin timeline に現れる。
- title recognition の regression がある。
- title が SP や課金力と結びつかない。

完了根拠:

- `SharedHistoryRecord` と `ActorTitleProgress` を PostgreSQL 正本として永続化する。
- admin history/titles、session state、prompt context への還流 regression がある。
- title recognition が SP ledger を変更しない regression がある。

### Phase 6: GESTALOKA-scale reference pack slice

状態: 完了

- `legacy/v1/documents/03_worldbuilding` を参考に、GESTALOKA 世界観の規模感を持つ reference pack slice を作る。
- 初期 slice は、階層世界、複数勢力、危険領域、汚染/浄化相当の world axis、歴史化、称号候補を含む。
- ログ NPC 生成、ログ派遣、dispatch は含めない。

完了条件:

- 既存 starter pack より構造的に大きい pack が、同じ engine suite を通る。
- world_axes と faction/history/title の regression が存在する。
- v1 コードやスキーマを copy-forward していない。

完了根拠:

- `packs/gestaloka_reference/` が `world_axes`、5 factions、4 history levels、3 title rules、shared consequence rules を宣言する。
- `tests/backend/packs/gestaloka_reference/test_gestaloka_reference_pack.py` で session flow、followup route、world canon、title recognition、SP 非連動を検証する。
- `make pack-validate` と backend suite が reference pack を含んで通る。

### Phase 7: verification hardening

状態: 未着手

- cross-player feedback、shared state drift、NPC memory persistence、pack-defined world-axis behavior の
  regression / eval gate を追加する。
- release checklist に Shared World Core の判定項目を追加する。
- observability は pack/template/world axis/faction/history dimension で確認できるようにする。

完了条件:

- `make verify-v2` が Shared World Core の regression を含む。
- release checklist が shared-world regression failure を promotion blocker として扱う。
- long-run で shared state drift を検知できる。

## 8. 検証

計画更新のみの段階では、以下を実行する。

```bash
make check-legacy
make scan-v1-terms
```

実装フェーズ開始後は、触った層に応じて以下を実行する。

```bash
PYTHONPATH=backend python -m pytest tests/backend
make pack-validate
make eval-pack-regressions
make verify-v2
```

## 9. 明示的にやらないこと

- `legacy/v1/` からの import
- v1 schema の copy-forward
- cross-world 参照
- Neo4j / neomodel の再導入
- Socket.IO 前提の復活
- ログ NPC 生成の復活
- ログ派遣 / dispatch の復活
- SP を世界内通貨、移動力、クエスト進行力として扱うこと
- 廃止済み/存在しない固定 model ID への依存
