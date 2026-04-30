# swarm-test レポート 2026-04-30T01-41-16-185Z

- 作成日時: 2026-04-30T01:46:04.657Z
- world_id: gestaloka_reference
- 試行: attempt-1

## ハードチェック

- ユーザーペルソナとプレイヤープロフィールの分離: 合格
- 実行時データへのユーザーペルソナ漏えいなし: 合格
- 全ターンが event_id を返す: 合格
- 全ターンイベントが同一 world_id に属する: 合格
- canonical sequence が一意: 合格
- 共有世界への影響が観測可能: 合格
- リソース競合が記録される: 合格
- 世界イベントまたは制約が観測可能: 合格

## ユーザーペルソナ

- Persona A: 小説愛好家: 性別=女性, 年齢=34, 職業=編集者, 趣味=小説, TRPG, 登場人物考察, 性格=共感的, 観察好き, 伏線や余韻を重視, 評価観点=自分の行動が他者の物語の一部になったと感じられるか。
- Persona B: MMO ゲーマー: 性別=男性, 年齢=29, 職業=営業職, 趣味=MMO, レイド攻略, ビルド検証, 性格=目標志向, 効率重視, 競争を楽しむ, 評価観点=同じ目標を巡る競合が公平に解決され、プレイが進み続けるか。
- Persona C: IT エンジニア: 性別=未指定, 年齢=41, 職業=ソフトウェアエンジニア, 趣味=技術検証, シミュレーションゲーム, ログ分析, 性格=分析的, 慎重, 因果関係を重視, 評価観点=broadcast、memory、timeline sequence、constraint の整合性が取れているか。

## 派生プレイヤープロフィール

- Persona A: 小説愛好家: Mio Archive Steward; 性別=女性; プレイ言語=en
- Persona B: MMO ゲーマー: Kaito Route Expediter; 性別=男性; プレイ言語=en
- Persona C: IT エンジニア: Sena Causality Auditor; 性別=未指定; プレイ言語=en

## ペルソナ別行動ログ

- Persona A: 小説愛好家: シナリオ=共有影響; 入力=選択肢; 行動=進行; 理由=このペルソナは、共有記憶として残る情緒的に意味のある支援を重視する。
- Persona A: 小説愛好家: シナリオ=リソース競合; 入力=選択肢; 行動=進行; 理由=このペルソナは、共有記憶として残る情緒的に意味のある支援を重視する。
- Persona B: MMO ゲーマー: シナリオ=リソース競合; 入力=選択肢; 行動=進行; 理由=このペルソナは、進行経路と共有リソース競合を負荷検証する。
- Persona C: IT エンジニア: シナリオ=世界イベント; 入力=自由入力; 行動=現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。; 理由=このペルソナは遅れて参加し、公開された世界イベントに追跡可能な原因があるかを検証する。

## ペルソナ別体験評価

- Persona A: 小説愛好家: 評価=良好; 観測された影響=支援行動が shared-world context に現れている。; 証跡=2fa116db-35f9-4324-8b65-57b8429c60a2 | 052efffc-98ac-4338-b8c0-a5ccb24d14b9 | session state / ops history / memory scan
- Persona B: MMO ゲーマー: 評価=良好; 観測された影響=同時行動の圧力により、resource constraint が記録された。; 証跡=410b78c7-890f-4bf1-b41c-48f03a9fca6f | event payload resource_constraints scan
- Persona C: IT エンジニア: 評価=良好; 観測された影響=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; 証跡=f5d97a09-21d7-4366-9321-cd897c9ad2d6 | session state broadcast constraint scan

## 実行時 ID

- novel-lover: actor_id=7e6c39df-e120-461b-bb81-d3bc00f0e883; session_id=77e919b0-0f57-421b-a080-7452a3c7d5b6; location_id=gestaloka_reference:nexus_gate; event_ids=2fa116db-35f9-4324-8b65-57b8429c60a2, 052efffc-98ac-4338-b8c0-a5ccb24d14b9; turn_ids=8ebf8fa8-cad5-4b95-a98d-2d0be720c10f, 382163c0-cdbd-46f6-bd74-d56c8f362e5d
- mmo-gamer: actor_id=55039dee-f33c-4a43-91aa-3432958e4023; session_id=65e9b510-8ef5-4a52-90e0-d864290ef721; location_id=gestaloka_reference:nexus_gate; event_ids=410b78c7-890f-4bf1-b41c-48f03a9fca6f; turn_ids=b76963e1-25fd-47fd-851c-a319c716e71a
- it-engineer: actor_id=7a570636-38c5-4fe5-9561-4f25b9081416; session_id=6e3a6d0a-4582-4f88-a54a-6bb9c35e75de; location_id=gestaloka_reference:nexus_gate; event_ids=f5d97a09-21d7-4366-9321-cd897c9ad2d6; turn_ids=3d7192ff-2437-4239-abc1-d2f08a65b8eb
