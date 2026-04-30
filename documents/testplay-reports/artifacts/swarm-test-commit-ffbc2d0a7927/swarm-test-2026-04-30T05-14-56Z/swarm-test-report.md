# swarm-test レポート 2026-04-30T05-14-56Z

- 作成日時: 2026-04-30T05:19:36.829Z
- world_id: gestaloka_reference
- 試行: attempt-1

## ハードチェック

- ユーザーペルソナとプレイヤープロフィールの分離: 失敗
- 実行時データへのユーザーペルソナ漏えいなし: 失敗
- 全ターンが event_id を返す: 失敗
- 全ターンイベントが同一 world_id に属する: 失敗
- canonical sequence が一意: 失敗
- 共有世界への影響が観測可能: 失敗
- リソース競合が記録される: 失敗
- 世界イベントまたは制約が観測可能: 失敗

## 失敗診断

- stage: resource_conflict_turns
- message: /turns failed: 500 Internal Server Error
- stack: Error: /turns failed: 500 Internal Server Error

## ユーザーペルソナ

- 小説愛好家の編集者: 性別=女性, 年齢=34, 職業=編集者, 趣味=小説, TRPG, 登場人物考察, 性格=共感的, 観察好き, 伏線や余韻を重視, 評価観点=自分の行動が他者の物語の一部になったと感じられるか。
- MMO レイド攻略者: 性別=男性, 年齢=29, 職業=営業職, 趣味=MMO, レイド攻略, ビルド検証, 性格=目標志向, 効率重視, 競争を楽しむ, 評価観点=同じ目標を巡る競合が公平に解決され、プレイが進み続けるか。
- 因果検証エンジニア: 性別=未指定, 年齢=41, 職業=ソフトウェアエンジニア, 趣味=技術検証, シミュレーションゲーム, ログ分析, 性格=分析的, 慎重, 因果関係を重視, 評価観点=broadcast、memory、timeline sequence、constraint の整合性が取れているか。

## 派生プレイヤープロフィール

- novel-editor: Mio NovelEditor; 性別=女性; プレイ言語=en
- raid-planner: Kaito RaidPlanner; 性別=男性; プレイ言語=en
- causality-engineer: Sena CausalityEngineer; 性別=未指定; プレイ言語=en

## ペルソナ別行動ログ


## ペルソナ別体験評価

- novel-editor: 評価=ブロック; 観測された影響=swarm-test stopped before hard checks at resource_conflict_turns.; 証跡=/turns failed: 500 Internal Server Error
- raid-planner: 評価=ブロック; 観測された影響=swarm-test stopped before hard checks at resource_conflict_turns.; 証跡=/turns failed: 500 Internal Server Error
- causality-engineer: 評価=ブロック; 観測された影響=swarm-test stopped before hard checks at resource_conflict_turns.; 証跡=/turns failed: 500 Internal Server Error

## 実行時 ID

- novel-editor: actor_id=12870496-dfd4-4b81-898c-e3efa4cb123a; session_id=fd464fe8-205f-48fb-83ca-b22f8bbfbd3f; location_id=gestaloka_reference:nexus_gate; event_ids=; turn_ids=
- raid-planner: actor_id=bebb0949-dc4d-42b8-ba8d-36945304e90b; session_id=90c7718e-a625-4c93-8fe6-8ece4749d5a6; location_id=gestaloka_reference:nexus_gate; event_ids=; turn_ids=
- causality-engineer: actor_id=cb0496ce-f44a-402f-bb3d-5a8406de0824; session_id=; location_id=; event_ids=; turn_ids=

