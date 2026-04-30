# swarm-test レポート 2026-04-30T05-52-33Z

- 作成日時: 2026-04-30T06:01:28.568Z
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

- 小説愛好家の編集者: 性別=女性, 年齢=34, 職業=編集者, 趣味=小説, TRPG, 登場人物考察, 性格=共感的, 観察好き, 伏線や余韻を重視, 評価観点=自分の行動が他者の物語の一部になったと感じられるか。
- MMO レイド攻略者: 性別=男性, 年齢=29, 職業=営業職, 趣味=MMO, レイド攻略, ビルド検証, 性格=目標志向, 効率重視, 競争を楽しむ, 評価観点=同じ目標を巡る競合が公平に解決され、プレイが進み続けるか。
- 因果検証エンジニア: 性別=未指定, 年齢=41, 職業=ソフトウェアエンジニア, 趣味=技術検証, シミュレーションゲーム, ログ分析, 性格=分析的, 慎重, 因果関係を重視, 評価観点=broadcast、memory、timeline sequence、constraint の整合性が取れているか。

## 派生プレイヤープロフィール

- novel-editor: Mio Story; 性別=女性; プレイ言語=en
- raid-planner: Kaito Mmo; 性別=男性; プレイ言語=en
- causality-engineer: Sena Engineer; 性別=未指定; プレイ言語=en

## ペルソナ別行動ログ

- novel-editor: シナリオ=共有影響; 入力=選択肢; 行動=進行; 理由=小説愛好家の編集者 values actions that can become shared memory through this lens: Can I feel that my action became part of someone else's story?; 期待する世界影響=局所的な支援行動が、後続の噂・関係性・world beat として現れることを期待する。
- novel-editor: シナリオ=リソース競合; 入力=選択肢; 行動=進行; 理由=小説愛好家の編集者 pressure-tests progress paths and shared-resource contention through this play style: Helps local figures and chooses emotionally legible stabilizing actions.; 期待する世界影響=同時進行時の競合が公平に解決され、プレイを止めずに resource constraint が記録されることを期待する。
- raid-planner: シナリオ=リソース競合; 入力=選択肢; 行動=進行; 理由=MMO レイド攻略者 pressure-tests progress paths and shared-resource contention through this play style: Pushes progress quickly, accepts conflict, and probes shared resources.; 期待する世界影響=同時進行時の競合が公平に解決され、プレイを止めずに resource constraint が記録されることを期待する。
- causality-engineer: シナリオ=世界イベント; 入力=自由入力; 行動=現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。; 理由=因果検証エンジニア joins late and probes whether public world events have a traceable cause.; 期待する世界影響=応答から broadcast、memory、recent history を通じた共有世界の連続性が観測できることを期待する。

## ペルソナ別体験評価

- novel-editor: 評価=良好; 観測された影響=支援行動が shared-world context に現れている。; 証跡=6fc6aa4f-0ca4-437e-8472-b456aace6234 | f32b7fa4-09cd-4731-844c-4a9efef987c1 | session state / ops history / memory scan
- raid-planner: 評価=良好; 観測された影響=同時行動の圧力により、resource constraint が記録された。; 証跡=1080a5a4-f67b-4474-b98f-6f7c52b7b9e5 | event payload resource_constraints scan
- causality-engineer: 評価=良好; 観測された影響=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; 証跡=78e3c0ce-1e2e-4735-892a-216aeb61599c | session state broadcast constraint scan

## 実行時 ID

- novel-editor: actor_id=3e93e1e3-8cd9-4118-8d4e-91a21fe432ea; session_id=8def3061-bec3-40af-be59-e78120dc2955; location_id=gestaloka_reference:nexus_gate; event_ids=6fc6aa4f-0ca4-437e-8472-b456aace6234, f32b7fa4-09cd-4731-844c-4a9efef987c1; turn_ids=b23b4297-f605-4834-93f6-c113ecf2c67d, d1b1e29f-f29b-4d88-be92-27240b6bd464
- raid-planner: actor_id=13e038be-3d7e-49f9-8e79-e21f5b71da55; session_id=7c414fc2-04e8-4377-ae20-c8467955a901; location_id=gestaloka_reference:nexus_gate; event_ids=1080a5a4-f67b-4474-b98f-6f7c52b7b9e5; turn_ids=d8ba77f8-ca9a-48bc-a78a-fd1cfb060d98
- causality-engineer: actor_id=41210d29-975d-41fa-bd4a-54b3ff6025a9; session_id=86f40d38-54bd-4a36-b933-c63c13947209; location_id=gestaloka_reference:nexus_gate; event_ids=78e3c0ce-1e2e-4735-892a-216aeb61599c; turn_ids=9073aacb-b248-4f02-91de-66570edd9a8b

