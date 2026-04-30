# swarm-test レポート 2026-04-30T05-22-57Z

- 作成日時: 2026-04-30T05:28:29.982Z
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
- message: apiRequestContext.post: Timeout 60000ms exceeded.
Call log:
[2m  - → POST http://localhost:8000/sessions[22m
[2m    - user-agent: Playwright/1.59.1 (x64; ubuntu 24.04) node/24.14 CI/1[22m
[2m    - accept: */*[22m
[2m    - accept-encoding: gzip,deflate,br[22m
[2m    - Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJoSjMtZzZXT3RXOVAyWGI3eE9adDlmQlB6QnJ2Mk1SeWdxOUZ2ckRwV3h3In0.eyJleHAiOjE3Nzc1MjcxNDksImlhdCI6MTc3NzUyNjg0OSwianRpIjoib25ydHJvOjdhODhiN2NjLWE5NGYtNGZjNC05NDJjLWVkOWFjMjhmYzRhNyIsImlzcyI6Imh0dHA6Ly9sb2NhbGhvc3Q6ODA4MC9yZWFsbXMvZ2VzdGFsb2thIiwic3ViIjoic3dhcm0tYy1zdWIiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJnZXN0YWxva2EtZnJvbnRlbmQiLCJzaWQiOiIxM2EzZjdiNy00NTBiLTQ3YzYtOWEzZC0xM2U3YjBkZjdiMTEiLCJhY3IiOiIxIiwiYWxsb3dlZC1vcmlnaW5zIjpbImh0dHA6Ly9sb2NhbGhvc3Q6NTE3MyJdLCJzY29wZSI6InByb2ZpbGUgZW1haWwiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwibmFtZSI6IlN3YXJtIEMiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJzd2FybS1jIiwiZ2l2ZW5fbmFtZSI6IlN3YXJtIiwiZmFtaWx5X25hbWUiOiJDIiwiZW1haWwiOiJzd2FybS1jQGV4YW1wbGUuY29tIn0.cLPPh6Srz86LszKvWEXsZZx0UOF-0BQZwlDze9HDAo3dL7Kyt55isC20DNcuGem93uEjw0pwhzvHHIHFq-S1ICH-BaPLQ_aYRlV1MPY3QWz3efw7hDjNlwpVQD3SbJtZJzUSVC7Rjexia_NGcjbQ4D1pSo3Y5yojIN3Mi5v2ziPApvhsRC-X5lzxjwDceRM697TmpPZIRWY_rzyHgzbIva_KBGhf8GgkuU6KUnd18F8grhu_e8z76tbBgNi3sS_n6NAYdcOCd5jW9MVz8kV0a17NyFbGnnu9ybvrk0lJ5p6XjllCu4P-lqH2bO4r6gr-xQPQ_98hHNX6XTCzX7xzDw[22m
[2m    - content-type: application/json[22m
[2m    - content-length: 91[22m

- stack: apiRequestContext.post: Timeout 60000ms exceeded.

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

- novel-editor: 評価=ブロック; 観測された影響=swarm-test stopped before hard checks at resource_conflict_turns.; 証跡=apiRequestContext.post: Timeout 60000ms exceeded.
Call log:
[2m  - → POST http://localhost:8000/sessions[22m
[2m    - user-agent: Playwright/1.59.1 (x64; ubuntu 24.04) node/24.14 CI/1[22m
[2m    - accept: */*[22m
[2m    - accept-encoding: gzip,deflate,br[22m
[2m    - Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJoSjMtZzZXT3RXOVAyWGI3eE9adDlmQlB6QnJ2Mk1SeWdxOUZ2ckRwV3h3In0.eyJleHAiOjE3Nzc1MjcxNDksImlhdCI6MTc3NzUyNjg0OSwianRpIjoib25ydHJvOjdhODhiN2NjLWE5NGYtNGZjNC05NDJjLWVkOWFjMjhmYzRhNyIsImlzcyI6Imh0dHA6Ly9sb2NhbGhvc3Q6ODA4MC9yZWFsbXMvZ2VzdGFsb2thIiwic3ViIjoic3dhcm0tYy1zdWIiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJnZXN0YWxva2EtZnJvbnRlbmQiLCJzaWQiOiIxM2EzZjdiNy00NTBiLTQ3YzYtOWEzZC0xM2U3YjBkZjdiMTEiLCJhY3IiOiIxIiwiYWxsb3dlZC1vcmlnaW5zIjpbImh0dHA6Ly9sb2NhbGhvc3Q6NTE3MyJdLCJzY29wZSI6InByb2ZpbGUgZW1haWwiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwibmFtZSI6IlN3YXJtIEMiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJzd2FybS1jIiwiZ2l2ZW5fbmFtZSI6IlN3YXJtIiwiZmFtaWx5X25hbWUiOiJDIiwiZW1haWwiOiJzd2FybS1jQGV4YW1wbGUuY29tIn0.cLPPh6Srz86LszKvWEXsZZx0UOF-0BQZwlDze9HDAo3dL7Kyt55isC20DNcuGem93uEjw0pwhzvHHIHFq-S1ICH-BaPLQ_aYRlV1MPY3QWz3efw7hDjNlwpVQD3SbJtZJzUSVC7Rjexia_NGcjbQ4D1pSo3Y5yojIN3Mi5v2ziPApvhsRC-X5lzxjwDceRM697TmpPZIRWY_rzyHgzbIva_KBGhf8GgkuU6KUnd18F8grhu_e8z76tbBgNi3sS_n6NAYdcOCd5jW9MVz8kV0a17NyFbGnnu9ybvrk0lJ5p6XjllCu4P-lqH2bO4r6gr-xQPQ_98hHNX6XTCzX7xzDw[22m
[2m    - content-type: application/json[22m
[2m    - content-length: 91[22m

- raid-planner: 評価=ブロック; 観測された影響=swarm-test stopped before hard checks at resource_conflict_turns.; 証跡=apiRequestContext.post: Timeout 60000ms exceeded.
Call log:
[2m  - → POST http://localhost:8000/sessions[22m
[2m    - user-agent: Playwright/1.59.1 (x64; ubuntu 24.04) node/24.14 CI/1[22m
[2m    - accept: */*[22m
[2m    - accept-encoding: gzip,deflate,br[22m
[2m    - Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJoSjMtZzZXT3RXOVAyWGI3eE9adDlmQlB6QnJ2Mk1SeWdxOUZ2ckRwV3h3In0.eyJleHAiOjE3Nzc1MjcxNDksImlhdCI6MTc3NzUyNjg0OSwianRpIjoib25ydHJvOjdhODhiN2NjLWE5NGYtNGZjNC05NDJjLWVkOWFjMjhmYzRhNyIsImlzcyI6Imh0dHA6Ly9sb2NhbGhvc3Q6ODA4MC9yZWFsbXMvZ2VzdGFsb2thIiwic3ViIjoic3dhcm0tYy1zdWIiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJnZXN0YWxva2EtZnJvbnRlbmQiLCJzaWQiOiIxM2EzZjdiNy00NTBiLTQ3YzYtOWEzZC0xM2U3YjBkZjdiMTEiLCJhY3IiOiIxIiwiYWxsb3dlZC1vcmlnaW5zIjpbImh0dHA6Ly9sb2NhbGhvc3Q6NTE3MyJdLCJzY29wZSI6InByb2ZpbGUgZW1haWwiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwibmFtZSI6IlN3YXJtIEMiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJzd2FybS1jIiwiZ2l2ZW5fbmFtZSI6IlN3YXJtIiwiZmFtaWx5X25hbWUiOiJDIiwiZW1haWwiOiJzd2FybS1jQGV4YW1wbGUuY29tIn0.cLPPh6Srz86LszKvWEXsZZx0UOF-0BQZwlDze9HDAo3dL7Kyt55isC20DNcuGem93uEjw0pwhzvHHIHFq-S1ICH-BaPLQ_aYRlV1MPY3QWz3efw7hDjNlwpVQD3SbJtZJzUSVC7Rjexia_NGcjbQ4D1pSo3Y5yojIN3Mi5v2ziPApvhsRC-X5lzxjwDceRM697TmpPZIRWY_rzyHgzbIva_KBGhf8GgkuU6KUnd18F8grhu_e8z76tbBgNi3sS_n6NAYdcOCd5jW9MVz8kV0a17NyFbGnnu9ybvrk0lJ5p6XjllCu4P-lqH2bO4r6gr-xQPQ_98hHNX6XTCzX7xzDw[22m
[2m    - content-type: application/json[22m
[2m    - content-length: 91[22m

- causality-engineer: 評価=ブロック; 観測された影響=swarm-test stopped before hard checks at resource_conflict_turns.; 証跡=apiRequestContext.post: Timeout 60000ms exceeded.
Call log:
[2m  - → POST http://localhost:8000/sessions[22m
[2m    - user-agent: Playwright/1.59.1 (x64; ubuntu 24.04) node/24.14 CI/1[22m
[2m    - accept: */*[22m
[2m    - accept-encoding: gzip,deflate,br[22m
[2m    - Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJoSjMtZzZXT3RXOVAyWGI3eE9adDlmQlB6QnJ2Mk1SeWdxOUZ2ckRwV3h3In0.eyJleHAiOjE3Nzc1MjcxNDksImlhdCI6MTc3NzUyNjg0OSwianRpIjoib25ydHJvOjdhODhiN2NjLWE5NGYtNGZjNC05NDJjLWVkOWFjMjhmYzRhNyIsImlzcyI6Imh0dHA6Ly9sb2NhbGhvc3Q6ODA4MC9yZWFsbXMvZ2VzdGFsb2thIiwic3ViIjoic3dhcm0tYy1zdWIiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJnZXN0YWxva2EtZnJvbnRlbmQiLCJzaWQiOiIxM2EzZjdiNy00NTBiLTQ3YzYtOWEzZC0xM2U3YjBkZjdiMTEiLCJhY3IiOiIxIiwiYWxsb3dlZC1vcmlnaW5zIjpbImh0dHA6Ly9sb2NhbGhvc3Q6NTE3MyJdLCJzY29wZSI6InByb2ZpbGUgZW1haWwiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwibmFtZSI6IlN3YXJtIEMiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJzd2FybS1jIiwiZ2l2ZW5fbmFtZSI6IlN3YXJtIiwiZmFtaWx5X25hbWUiOiJDIiwiZW1haWwiOiJzd2FybS1jQGV4YW1wbGUuY29tIn0.cLPPh6Srz86LszKvWEXsZZx0UOF-0BQZwlDze9HDAo3dL7Kyt55isC20DNcuGem93uEjw0pwhzvHHIHFq-S1ICH-BaPLQ_aYRlV1MPY3QWz3efw7hDjNlwpVQD3SbJtZJzUSVC7Rjexia_NGcjbQ4D1pSo3Y5yojIN3Mi5v2ziPApvhsRC-X5lzxjwDceRM697TmpPZIRWY_rzyHgzbIva_KBGhf8GgkuU6KUnd18F8grhu_e8z76tbBgNi3sS_n6NAYdcOCd5jW9MVz8kV0a17NyFbGnnu9ybvrk0lJ5p6XjllCu4P-lqH2bO4r6gr-xQPQ_98hHNX6XTCzX7xzDw[22m
[2m    - content-type: application/json[22m
[2m    - content-length: 91[22m


## 実行時 ID

- novel-editor: actor_id=12870496-dfd4-4b81-898c-e3efa4cb123a; session_id=8f5d737a-c903-4396-90a0-69f5168c5b58; location_id=gestaloka_reference:nexus_gate; event_ids=; turn_ids=
- raid-planner: actor_id=bebb0949-dc4d-42b8-ba8d-36945304e90b; session_id=9e9967c2-f66a-4aae-b315-8c9d7cf6ef67; location_id=gestaloka_reference:nexus_gate; event_ids=; turn_ids=
- causality-engineer: actor_id=cb0496ce-f44a-402f-bb3d-5a8406de0824; session_id=; location_id=; event_ids=; turn_ids=

