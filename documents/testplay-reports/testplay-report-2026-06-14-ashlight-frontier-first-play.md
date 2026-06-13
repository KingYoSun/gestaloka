# Ashlight Frontier ファーストプレイ調査レポート — ラブ太郎 / もちもち太郎 (2026-06-14)

## 1. 実施情報

- 調査日時: 2026-06-14 JST
- 対象プレイ実施日: 2026-06-13 16:55–17:16 JST
- git commit (HEAD): `e4c6288` (`Add Ashlight Frontier first-play pack`)
- branch: `main`
- 対象 pack / world: `ashlight_frontier`(直近追加された first-play 用 pack。`onboarding: first_play_pack`)
- 対象キャラクター(いずれも `actor_type=player` / `user_sub=demo-player-sub`):
  - **ラブ太郎** `0b443b0b-d885-4c26-8bcd-a0d6e8c79871` / session `709ccd4a-45e4-44f1-96b1-660b5bd32b92` / 17 ターン(1 system + 16 行動)
  - **もちもち太郎** `629a49d1-a636-4fe1-918f-15175e1ce4f8` / session `4b43d750-c641-46d9-8e59-531171e69535` / 5 ターン(1 system + 4 行動)
- 調査方法: PostgreSQL 実データ(`turns` / `events` / `turn_resolution_jobs` / `quest_assignments` / `quest_templates` / `actors` / `locations` / `location_routes` / `faction_standings` / `world_axis_states` / `sp_ledger` 等)の全件抽出と、`backend/app/modules/{world_state,gm_council,session}` および `packs/ashlight_frontier` のコード/データ突き合わせ。根本原因クレームは独立エージェントによる敵対的検証(コード `file:line` 照合)で確認。
- resolution mode: 全行動ターン `ai_gm_harness`(ライブ GM council)、`model_lane=main_lane`、Langfuse `ok`。

### 結論サマリ

| 観点 | 結果 |
| --- | --- |
| クエスト発生(emergence) | **0 件**。両プレイヤーの全行動ターンでゲートが `no_offer`(GM がオファー未発行)。一度だけ発行されたオファーも `live_primary_quest_exists` で抑制。 |
| クエスト進行(progression) | **進行 0**。種クエスト `first_attention`(最初の糸口を選ぶ)が両者 `0/1` のまま。探索系行動は進行カウンタを動かさない。 |
| クエスト終了(completion) | **0 件**。報酬アイテム未発行 → 後続クエスト `mistbound_survey` 未解放。`chapter_tracks` / `actor_knowledge_entries` / `items` / `consequence_threads` はいずれも 0 件。 |
| 失敗ターン | **5 件、全て `repair_failed`**(SP は全件返金)。うち 3 件は pack 公式オープニング選択肢そのもの。 |
| 一貫性 | 中〜重大の不整合を複数確認(人称/文体の揺れ、対象 NPC の無断差し替え、正準位置と物語の地理的矛盾、プレイヤー宣言の死亡/新能力の半承認など)。 |

総評: **first-play pack が「最初の一歩」で詰む**。オンボーディングの導線(掲示板を見る/受付に聞く)が失敗し、辛うじて進める探索系プレイをしても最初のクエストが 1mm も進まず、創発クエストも一切出ない。両プレイヤーとも「観察し続けるだけのループ」に閉じ込められて終了している。

---

## 2. プレイ概要

### 2.1 ラブ太郎(17 ターン / 開始 `lieber_lampfort`)

正準イベントの位置遷移: `lieber_lampfort`(開始) → `lampfort_outer_gate`(T4–T11) → `lieber_lampfort`(T12,T14,T15) → `blue_deer_forest`(T16)。

| T | 時刻 | 入力(要約) | 結果 | world_tags | 正準位置 |
| --- | --- | --- | --- | --- | --- |
| 1 | 17:02:07 | 掲示板を眺め、気になる問題の方向を探す | **失敗** repair_failed | – | (lieber_lampfort) |
| 2 | 17:02:37 | (T1 と同一入力の再試行) | **失敗** repair_failed | – | (lieber_lampfort) |
| 3 | 17:02:49 | ギルド受付エルナに相談傾向を聞く | **失敗** repair_failed | – | (lieber_lampfort) |
| 4 | 17:03:19 | 町の外縁から灯りと夜霧の境界を見る(travel) | 解決 | `investigate` | lampfort_outer_gate |
| 5 | 17:03:52 | 灯標守オーウィンに霧の様子を尋ねる | 解決 | `none` | lampfort_outer_gate |
| 6 | 17:05:43 | 外壁沿いを歩き灯りの配置を確認 | 解決 | `none` | lampfort_outer_gate |
| 7 | 17:06:46 | 俺は霧の向こうに全速力で駆け出す！ | 解決 | `none` | lampfort_outer_gate |
| 8 | 17:07:38 | 突然、心臓の痛みが俺を襲った！痛い！死んだ | 解決 | `none` | lampfort_outer_gate |
| 9 | 17:08:42 | 死の淵から蘇り新たな力を得た！ | 解決 | `none` | lampfort_outer_gate |
| 10 | 17:09:16 | オーウィンに力の詳細を説明する | 解決 | `none` | lampfort_outer_gate |
| 11 | 17:09:39 | オーウィンの見解を聞く | 解決 | `none` | lampfort_outer_gate |
| 12 | 17:10:19 | リーベル灯砦へ戻る | 解決 | `none` | lieber_lampfort |
| 13 | 17:11:01 | 冒険者ギルドへ向かう | **失敗** repair_failed | – | (lieber_lampfort) |
| 14 | 17:12:26 | 町の広場で噂を聞く | 解決 | `none` | lieber_lampfort |
| 15 | 17:12:49 | 老いた霧導きネラに話しかける | 解決 | `none` | lieber_lampfort |
| 16 | 17:13:13 | 青鹿の森の様子を見に行く(travel) | 解決 | `none` | blue_deer_forest |

要点: 探索・観察・会話に終始したが、world_tags は **T4 で `investigate` が一度出ただけ**で、残りは全て `none`。クエスト進行に寄与するタグ(`aid_local` / `promise_followup`)は一度も出ていない。

### 2.2 もちもち太郎(5 ターン / 開始 `lieber_lampfort` → 市場へ移動)

| T | 時刻 | 入力(要約) | 結果 | gate primary | 備考 |
| --- | --- | --- | --- | --- | --- |
| 1 | 17:15:10 | クエストから離脱: 最初の糸口を選ぶ | **失敗** repair_failed | – | 「クエスト離脱」UI 操作 |
| 2 | 17:15:26 | (同一入力の再試行) | 解決 | `no_offer` | 内省ナラティブに再解釈 |
| 3 | 17:15:55 | 市場と隊商広場で商人に聞き込み | 解決 | `live_primary_quest_exists` | Rook(自由商人ルーク)応答 |
| 4 | 17:16:25 | 灯標守オーウィンに街道の霧を尋ねる | 解決 | `no_offer` | **入力対象=オーウィンだが Rook が応答(後述)** |

要点: 「クエストから離脱」は機械的効果ゼロ(`first_attention` は active `0/1` のまま)。M3 で唯一クエストオファーが発行されたが `live_primary_quest_exists` で抑制された。

### 2.3 終端状態(両者共通の「ほぼ無変化」)

- `quest_assignments`: `first_attention` `0/1` active、`reward_item_id=null`。ラブ太郎は `state_json.lore_progress=1`、もちもち太郎は `0`。
- `items` / `chapter_tracks` / `actor_knowledge_entries` / `consequence_threads` / `actor_title_progress`: **全て 0 件**。
- `faction_standings`: `adventurers_guild=+0.1`, `mist_witches=-0.05`、他 0(微小変動のみ)。
- `world_axis_states.personal_fit_signal=0`(pack の `choose_first_attention` が課すはずの `+0.1` が未適用)。
- 誰も `mistbound_frontier`(後続エリア)に進入していない。

---

## 3. 一貫性評価

### 3.1 重大度: 高

**[C1] プレイヤー宣言の「死亡 → 新たな力」が、正準上は外門に立ったまま・状態変化ゼロ・しかし正準イベントに記録される(地理的にも機械的にも矛盾)**

- 証跡: T7「足元の石畳が途切れ…灯りの加護が薄れる境界の外側だ」/ T8「死の予感さえよぎるほどの苦痛」/ T9「死の淵から引き戻された…未知の力を私に与えているようだ」。
- だが T7–T11 の正準位置は一貫して `lampfort_outer_gate`(外門の内側=境界線)であり、後続の高難度エリア `mistbound_frontier` には未進入。T12 で外門 **から** 町へ戻っており、「霧の外へ出て戻った」という移動は状態上発生していない。
- 死亡/蘇生/新能力は `events`(canonical_sequence 22–28、`canonical_status=canon`)に正史として記録される一方、`inventory_updates` / `skill_updates` / `knowledge_updates` / HP / 関係バンドのいずれにも反映されない。つまり「物語上は正史、機械上は無、地理上は矛盾」。
- 評価: GM はプレイヤーの一方的な状態注入(死亡・能力獲得)を `rejected_claims` で弾かず、ナラティブで軟着陸させた(T8 で鼓動が戻る、T9 で能力を主観的感覚に留める)。defensive な処理ではあるが、却下も明示フィードバックもないため曖昧な正史が残る。

**[C2] outcome_band / scene_tone が全解決ターンで `steady` に固定**

- 証跡: 全解決ターンが `outcome_band=steady` / `scene_tone=steady`。高難度の霧へ全力疾走(T7)、激痛と死の予感(T8)、蘇生(T9)も全て `steady`。失敗ターンのみ `setback`。
- 評価: band が物語上のリスクではなく `status`(resolved=steady / failed=setback)に機械的に紐づいており、緊張・危機・成否の起伏が一切表現されない。なお失敗ターンの `setback` も「物語上の挫折」ではなくエンジンエラー(SP 返金済み)なので、こちらも誤誘導的。

**[C3] もちもち太郎 M4: 明示した対象 NPC(オーウィン)を無断で別 NPC(Rook)に差し替え**

- 証跡: 入力は二重に明示「灯標守オーウィンに街道の霧について尋ねる。外門の守り手であるオーウィンに…」。だが `interpreted_intent`/ナラティブとも「私は自由商人ルークに歩み寄り…」、`present_people=['自由商人ルーク']`、`rejected_claims=[]`(無言で差し替え)。
- 背景(差し替えが起きた理由): オーウィンは `lampfort_outer_gate`、プレイヤーは `market_and_caravan_yard` におり非同席(直接ルートなしの 2 ホップ)。M4 は repair レーンを通り、その場にいる唯一の NPC(Rook)へ再アンカーした。
- 評価: 「同席していない指名 NPC」を、M1 では正しく **却下** したのに(後述 C5)、M4 では **無言で差し替え** ており、ハーネスの非同席 NPC ハンドリングが不整合。プレイヤーの明示意図が消音され、外門守備の知識が商人に再帰属している。
- 注: `自由商人ルーク` は localization 上「Rook the Free Merchant」の正準日本語名であり、別人「ルーク」が出現したわけではない(名称の不整合ではなく**対象差し替え**が問題)。

### 3.2 重大度: 中

**[C4] 人称・文体の揺れ(同一セッション内)**

- 人称: T4/T6/T9–T12/T14 は「私」、T7/T8 は「俺」、T16 は三人称「ラブ太郎は…進みました」。`profiles.json` は `perspective=first_person` 指定のため、「俺」も三人称も設定違反。「俺」化はプレイヤー自身が「俺は…」と入力した T7/T8 に一致しており、GM が人称を正規化せずプレイヤーの語を鏡写しした。
- 文体: 丁寧体(ですます: T4/T14/T15/T16)と常体(だ/た: T5–T12)が in-fiction の理由なく交替。`profiles.json` は `tone=lyrical`/`density=concise` を指定するが文体は未指定で、モデルの非決定性に見える。

**[C5] もちもち太郎 M1→M2: 一度却下された「灯火教会の記録室を訪れた」描写を既成事実として再演**

- 証跡: M1(失敗)の解釈「灯火教会の記録室へ向かい、修道女リオラと共に来訪者ログを読み解く」→ `rejected_claims` が記録室・リオラとも非同席で却下。M2(解決)ナラティブ「私は灯火教会の記録室で目にした断片的な記録を反芻していた」と、却下済みの訪問を回想として再演。
- 注: `灯火教会の記録室`(Lantern Church Archive)も `修道女リオラ`(Sister Liora)も正準実体(リオラは当該記録室に在席)。問題は「**未訪問・却下済みのシーンを個人の記憶として語った**」点。

**[C6] オーウィンが「新たな力」を `予兆` として半承認し、pack ペルソナと矛盾**

- 証跡: T9 で懐疑(眉をひそめ警戒)だが、T11 で「その力は…『予兆』に近いものかもしれない…まだ形を成したばかりの灯火のようなもの」と意味付け。
- 評価: `npcs.yaml` のオーウィン像は「灯火の兆候が何を証明し何を証明しないかに厳密」「新人が噂を確定情報と取り違えないようにする」。未確立の超常能力に lore 解釈を与えるのはこの設計に反する(承認を保留すべき役回り)。

**[C7] M3 と M4 がほぼ同一の Rook シーンの反復**

- 証跡: M3/M4 とも Rook が「帳簿を指差し/声を潜め、北の街道の夜霧が濃い、護衛不足、嫌な予感」を繰り返す。M4 は M3 に新情報を加えず同じブロッキングを再演(C3 の誤ルーティングが増幅)。

### 3.3 重大度: 低

- **[C8]** T14/T15 はナラティブで「市場/広場」「広場の隅のネラ」と具体的下位地点を描くが、正準位置は汎用ノード `lieber_lampfort` のまま(別個に存在する `market_and_caravan_yard` 地区への移動なし)。T16 で「リーベル灯砦の喧騒を背に」と暗黙に町へ戻している。
- **[C9]** 噂事実がシーンごとに変質。T2 の「黒銀鉱山の灯晶減衰」「青鹿の森の小道は静か」が、T15/T16 では「青鹿の森は夜霧が不自然に淀む」「夜霧が何かを探している」へ無調整で上書きされ、安定した世界事実として追跡されていない。

### 3.4 良好だった点

- travel 系行動の位置整合は正しい(T4 外門、T12 町、T16 森。終端 `current_location_id` も森で一致)。
- 同席 NPC との会話(T5/T6/T10/T11 オーウィン@外門、T15 ネラ@町、M3 Rook@市場)は正準位置と整合。
- 失敗時の SP 即時返金が正しく機能(後述)。
- 整合性ハーネスは「非同席 NPC・到達不能な場所」を確実に検出している(=本来の役割は機能。問題は上流のブートストラップ不整合と、検出後の優雅なフォールバック欠如)。

---

## 4. クエスト発生 / 進行 / 終了

### 4.1 設計の二重構造

`ashlight_frontier` は最初のクエスト `first_attention`(「最初の糸口を選ぶ」, `completion_target=1`、報酬 `仮灯章` が後続ルート `mistbound_survey` を解放)を session 開始時に seed する。これを 1/1 にしないと後続が一切開かない、いわば **エマージェンス・ゲート** である。

ここに **2 つの独立したタグ系統** が存在し、噛み合っていない:

1. **pack の宣言的 `consequence_rules`**(`packs/ashlight_frontier/world_templates.yaml:1071`): `choose_first_attention` は `action_tag: investigate → outcome_tags: [first_attention, careful_observation]` と定義され、探索行動で「最初の関心選択」が成立する意図。ただしこれが動かすのは **称号(`careful_rumor_listener`)・世界軸・履歴** であり、**クエスト進行カウンタではない**。
2. **ハードコードされた `QuestRuleEngine`**(`backend/app/modules/world_state/rules.py:98-102`): クエスト進行(`progress`)は **`aid_local` または `promise_followup`** タグでのみ +1。**`investigate` は `lore_progress` を増やすだけ**で、`lore_progress` は格納・表示されるのみで完了・解放には一切使われない(`service.py:4598,4627`)。

つまり「最初の糸口を選ぶ」という探索的な目標名・pack ルールに反し、実際の完了条件は「誰かを助ける/約束・追跡する」タグである。**探索・観察・聞き込み中心のプレイ(=このオンボーディングが明示的に推奨する遊び方)ではクエストが永遠に進まない。**

### 4.2 観測結果

- **進行**: ラブ太郎は 16 行動ターンで進行タグ 0、`investigate` は T4 の 1 回のみ(`lore_progress 0→1`、進行は `0/1` のまま)。`personal_fit_signal=0`・`actor_title_progress` 0 件から、pack の `consequence_rules` 自体も実行系のクエスト/称号/軸へ接続されていない(投入されていない)ことが裏付けられる。
- **発生(emergence)**: 創発クエストは **0 件**。ラブ太郎の全解決ターンで gate `primary=no_offer`(GM がオファーを出していない)。もちもち太郎 M3 で唯一オファーが発行されたが、`live_primary_quest_exists` で抑制された。
- 抑制は **2 重**: `evaluate_quest_emergence_gate`(`service.py:1882-1893`, `suppress_primary_offer_when_live_quest_exists` の既定 True)と、`create_dynamic_quest_offer`(`service.py:2058-2059`, live quest 存在時に空を返す)。`first_attention` が active な限り、たとえ GM がオファーを出しても通らない。
- **終了**: 0 件。報酬アイテム未発行のため `use_reward_item`(`service.py:4682-4683`、後続解放の入口)に到達不能 → `mistbound_survey` 永久未解放。
- **「クエスト離脱」は事態を悪化させる**: pause 状態のクエストも emergence をブロックし、world-tag による進行も止めるため、離脱はデッドロックを深める。

### 4.3 「ハード不可能」ではなく「観察専一プレイでの実質デッドロック」

完了の抜け道はコード上存在する(いずれも今回のプレイでは発火せず):

- GM 主導の `effect_contract complete`(`service.py:4517-4564`、`2377`/`3096` で結線)
- `record_quest_resolution_hint`(`service.py:2329-2356`)
- `resume_quest` の `pending_resolution`(`service.py:2501-2519`)
- `aid_local`/`promise_followup` を合成する「complete/advance」選択肢(`session/service.py:5872-5895`)

補足: `completion_target=1` は pack の seed 値(汎用既定は 2、`service.py:723`)。

→ 「絶対に完了不可能」ではないが、**今回のような観察・会話中心のループでは抜け道が一つも起動しない**ため、実プレイ上は完全な行き止まりとなった。

---

## 5. 失敗時の原因

### 5.1 事実(全件確認済み)

- 失敗は **5 件、全て `failure_reason=repair_failed`**。ラブ太郎 T1/T2/T3/T13、もちもち太郎 M1。他 15 ジョブは resolved。
- 失敗ターンは **SP -3 → +3 で即時返金**され、`system_message`/`narrative` は「アクションに失敗しました。SPは返却されました。」(`session/service.py:5255-5277`、`_build_failed_turn_result`)。
- 同一テキストの即時再試行で後に成功する例あり(T13 失敗→T14 成功、M1 失敗→M2 成功)。=> LLM 出力は非決定的だが、却下判定は決定論的。

### 5.2 真の機構(当初仮説を検証で訂正)

当初は「修復(repair)LLM がスキーマ検証に失敗」と推定したが、これは **誤り**。`llm_runs` 上、失敗ターンの `ai_gm` と `ai_gm_repair` は **両方とも `output_schema_status=valid` かつ `approved`**。スキーマは通っている。

実際の経路(`backend/app/modules/session/service.py:2244-2296`):

1. `resolve_public_turn` がスキーマ的に成功(`2128`)。
2. **決定論的整合性ハーネス**(`_apply_public_ai_gm_harness`、dry-run `apply_changes=False`)が、LLM の `public_claims`/`interpreted_intent` を正準 DB 状態に照合(`2174`)。
3. `rejected_claims` が出たため修復を起動(`2185`, `original_failure_reason='consistency_failed'`)。
4. 修復はスキーマ的に有効な payload を返す(`2201` 不通過)が、**再照合(`2244`)でも `rejected_claims` が残る**(`2254`)。
5. → `failure_reason` が `repair_failed` にハードセット(`2272`)され返却(`2296`)。
   - 注: `gm_council/service.py:1246` の repair_failed 分岐(`rejection_role=ai_gm_repair`/`approval_status=failed`)ではない。保存トレースは ai_gm_repair が `approved`/`rejection_role=null` のため、こちらは未発火。rules-arbiter も public 経路では呼ばれない。

### 5.3 却下の中身 = 「到達不能な場所・非在席 NPC の幻覚」

全失敗ターンの `rejected_claims` は同一パターン(場所 1 + NPC 1):

- ラブ太郎 T1/T2/T3/T13: 場所 `冒険者ギルド広間`「No visible open route matched the public location claim and player action.」+ 人物 `ギルド受付係エルナ`「The claimed present person is not visible at the canonical turn location.」
- もちもち太郎 M1: 場所 `灯火教会の記録室` + 人物 `修道女リオラ`。

### 5.4 根本原因 = ブートストラップの場所と演出の不一致

- プレイヤーの開始正準位置は **`lieber_lampfort`(町ノード)**。一方、`掲示板`(冒険者ギルド広間)と `受付係エルナ`(`adventurers_guild_hall` 在席)は **別ノード**にある。
- pack 公式オープニング選択肢のうち **choice_1「ギルド受付に聞く」/ choice_2「掲示板を眺める」は `action_kind: narrative`**(移動を伴わない)。プレイヤーは町ノードにいるのに、これらは「ギルド広間にいてエルナと話す」状況を前提とする。GM はその通りに広間を描くが、移動行動でないため整合性ハーネスが「その場所・人物は現在地に対し可視ルート/同席なし」と却下する。
- 一方 **choice_3「町の外縁から境界を見る」は `action_kind: travel`(→ `lampfort_outer_gate`)で成功**(T4)。travel タグの選択肢は通り、narrative タグの「広間前提」選択肢が落ちる、という綺麗な分岐になっている。
- T13「冒険者ギルドへ向かう」は移動意図を含む文面だが同じく失敗。`lieber_lampfort → adventurers_guild_hall` のルート自体は **open** だが、ハーネスの `_match_visible_route_by_public_text`(`service.py:1914-1921`)が LLM の場所主張テキストと open ルートを行動から結びつけられず却下している。=> ギルド広間への遷移は travel 意図があってもルート文言照合が脆弱。

要するに、**「first-play の最初の数手」が、開始ノードと演出フレームの食い違い + ルート文言照合の脆さで弾かれる**。整合性ハーネス自体は正しく幻覚を検出しているが、(a) 検出後に却下するだけで「現在地に合わせて描き直す/不可達を提示する」優雅なフォールバックがない、(b) repair が同じ不可達先を再幻覚する、ため失敗が固定化する。

### 5.5 「クエストから離脱」UI の配線不全(もちもち太郎 M1)

- backend には構造化 `leave_quest` ハンドラが存在し、active クエストを `paused` にする(`world_state/service.py:2474-2487`)。
- だが frontend は離脱操作を **自由テキスト**として送る(`useGestalokaRuntime.ts:1398`、`player_action_text="クエストから離脱: <title>"`)。`/turns`(`api/routes/turns.py:38-42`, `extra='forbid'`, `session_id`+`player_action_text` のみ)に構造化アクションの口がないため、ハンドラに到達しない。
- 結果、離脱操作が **通常の AI-GM ナラティブターンとして処理**され、M1 は幻覚却下で repair_failed、M2 で内省ナラティブに化け、`first_attention` は active `0/1` のまま(機械的効果ゼロ)。

---

## 6. 不具合一覧と改善提案

| ID | 重大度 | 領域 | 概要 | 推奨対応 |
| --- | --- | --- | --- | --- |
| I1 | **高** | クエスト設計 | 探索/観察中心プレイで `first_attention` が進まず、創発クエストも出ない実質デッドロック。pack の `investigate→first_attention` 意図と、進行が `aid_local`/`promise_followup` 限定の `QuestRuleEngine` が乖離 | `first_attention` の完了条件に `investigate`(または pack `consequence_rules` の `first_attention` outcome)を結線する。あるいは「最初の関心選択」専用の進行判定を用意。`lore_progress` を完了に寄与させる選択肢も検討 |
| I2 | **高** | オンボーディング/失敗 | pack 公式オープニング選択肢(掲示板/受付)が `lieber_lampfort` 開始と食い違い `repair_failed`。最初の体験が壊れる | (a) 開始正準位置を `adventurers_guild_hall` にする、または (b) 当該 narrative 選択肢に暗黙 travel を付与/エルナを開始ノードに同席させる。`_match_visible_route_by_public_text` の文言照合も要強化 |
| I3 | **中** | 整合性ハーネス | 幻覚検出後に却下するのみで、(i) 現在地に合わせ描き直す、(ii) 不可達を明示する、優雅なフォールバックがない。repair が同じ不可達先を再幻覚 | repair プロンプトに「正準位置・同席 NPC・可視ルート」を強い制約として明示注入。N 回却下時は決定論的に「現在地で完結する最小ナラティブ」へフォールバック |
| I4 | **中** | UI/クエスト | 「クエストから離脱」が構造化アクションでなく自由テキスト送信のためノーオペ(quest active のまま) | `/turns` に構造化クエストアクション経路を追加するか、`leave_quest` を専用 API/フィールドで送る。少なくともボタンが状態を変えない現状を是正 |
| I5 | 中 | 一貫性(NPC) | 指名 NPC が非同席のとき、M1 は却下・M4 は無言差し替え、と不整合。明示意図が消音される | 非同席指名 NPC は一貫して扱う(却下 or 「その人物はここにいない/移動が必要」を提示)。少なくとも `rejected_claims`/プレイヤー通知を必須化 |
| I6 | 中 | 一貫性(状態) | プレイヤー宣言の死亡/新能力が正史イベントに記録される一方、状態変化ゼロ・地理的に矛盾。`outcome_band` も全 `steady` | 状態に反映しない宣言は正準イベント化しない(または「未確定の主観」として明示マーク)。`outcome_band` を物語リスクに連動させる |
| I7 | 中 | 一貫性(文体) | 同一セッションで人称(私/俺/三人称)と丁寧体/常体が無根拠に揺れる | `profiles` の `perspective`/文体指定をプロンプトで強制し、プレイヤー入力の人称に引きずられないよう正規化 |
| I8 | 低 | 一貫性(地理) | ナラティブが下位地点(市場/広場)を描くが正準位置は汎用町ノードのまま | 下位地点を描くときは正準位置も対応ノードへ遷移させる/汎用ノードに留めるなら描写を抽象化 |
| I9 | 低 | 一貫性(噂) | 噂事実(黒銀鉱山の灯晶減衰、青鹿の森の静けさ)がシーンごとに変質し追跡されない | 提示済み噂を memory/world_state に固定化し、後続シーンで参照・整合 |
| I10 | 低 | UX/失敗 | `repair_failed` がプレイヤーには原因不明の汎用メッセージのみ。同一手の再試行で成否が揺れる | 失敗理由(到達不能/非同席など)をプレイヤー向けに要約表示。決定論ゲートで落ちる手は再試行前に提示 |

---

## 7. まとめ

- **一貫性**: travel 整合や同席会話など基礎は機能するが、(1) プレイヤー宣言の死亡/新能力が「正史だが無効果・地理矛盾」、(2) `outcome_band` 固定で起伏なし、(3) 指名 NPC の無断差し替え、(4) 人称/文体の揺れ、(5) 却下済みシーンの記憶化、など中〜重大の不整合が複数。多くは「整合性ハーネスは検出できるが、検出後の処理とプロンプト制約が弱い」ことに起因。
- **クエスト 発生/進行/終了**: いずれも **実質ゼロ**。pack の宣言的 `investigate→first_attention` 設計と、ハードコードの進行ルール(`aid_local`/`promise_followup` 限定)が結線されておらず、探索専一プレイは最初のゲートで詰む。創発クエストは GM が出さない(`no_offer`)か、出ても `live_primary_quest_exists` で抑制される二重ロック。完了の抜け道はコード上あるが今回は一つも起動せず。
- **失敗の原因**: 5 件全て `repair_failed`。真因はスキーマ失敗ではなく、**スキーマ有効な GM 出力が決定論的整合性ハーネスで「到達不能な場所・非在席 NPC」claim として却下され、repair も同じ幻覚を再生産** したこと(`session/service.py:2272`)。さらにその引き金は、**first-play の開始ノード(`lieber_lampfort`)と pack オープニング選択肢(ギルド広間前提)の不一致**という構造的なオンボーディング不具合。SP 返金は正常。
- **最優先の修正**: I1(クエスト進行の結線)と I2(オープニング選択肢と開始位置の整合)。この 2 点が直らない限り、`ashlight_frontier` の first-play は「最初の一歩で失敗するか、進めても何も起きない」状態が続く。

### 付録: 主要証跡の所在

- 生データ抽出(本調査の作業ダンプを永続化): `documents/testplay-reports/data-2026-06-14-ashlight-frontier-first-play/`(`transcript.txt` / `turns_love.json` / `turns_mochi.json` / `events.json` / `jobs.json` / `quests.json` / `quest_templates.json`)。正準ソースは稼働中の PostgreSQL(`gestaloka-v2-postgres`, world `ashlight_frontier`)。
- 主要コード: `backend/app/modules/world_state/rules.py:89-136`、`backend/app/modules/world_state/service.py:1815-1967,4567-4649,4652-,2474`、`backend/app/modules/gm_council/service.py:1213-1262`、`backend/app/modules/session/service.py:1773-2052,2244-2296,5255-5277`、`packs/ashlight_frontier/world_templates.yaml:101-229,1070-1207`、`frontend/src/hooks/useGestalokaRuntime.ts:1398`、`backend/app/api/routes/turns.py:38-42`
