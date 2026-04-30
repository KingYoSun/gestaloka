# swarm-test attempt summary 2026-04-30T05-22-57Z

- 生成日時: 2026-04-30T05:28:29.986Z
- world_id: gestaloka_reference
- attempt 数: 1
- 最新 attempt: attempt-1
- 最新結果: 失敗

## Attempt 一覧

| attempt | 作成日時 | 結果 | persona 評価 | report |
| --- | --- | --- | --- | --- |
| attempt-1 | 2026-04-30T05:28:29.982Z | 失敗 | novel-editor=ブロック<br>raid-planner=ブロック<br>causality-engineer=ブロック | swarm-test-report-attempt-1.md |

## ハードチェック総合

| 項目 | 最新 | 通過 attempt |
| --- | --- | --- |
| ユーザーペルソナとプレイヤープロフィールの分離 | 失敗 | 0/1 |
| 実行時データへのユーザーペルソナ漏えいなし | 失敗 | 0/1 |
| 全ターンが event_id を返す | 失敗 | 0/1 |
| 全ターンイベントが同一 world_id に属する | 失敗 | 0/1 |
| canonical sequence が一意 | 失敗 | 0/1 |
| 共有世界への影響が観測可能 | 失敗 | 0/1 |
| リソース競合が記録される | 失敗 | 0/1 |
| 世界イベントまたは制約が観測可能 | 失敗 | 0/1 |

## ペルソナ別総合評価

### novel-editor

- 最新評価: ブロック
- 最新観測: swarm-test stopped before hard checks at resource_conflict_turns.
- attempt-1: 評価=ブロック; 観測=swarm-test stopped before hard checks at resource_conflict_turns.; 証跡=apiRequestContext.post: Timeout 60000ms exceeded.
Call log:
[2m  - → POST http://localhost:8000/sessions[22m
[2m    - user-agent: Playwright/1.59.1 (x64; ubuntu 24.04) node/24.14 CI/1[22m
[2m    - accept: */*[22m
[2m    - accept-encoding: gzip,deflate,br[22m
[2m    - Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJoSjMtZzZXT3RXOVAyWGI3eE9adDlmQlB6QnJ2Mk1SeWdxOUZ2ckRwV3h3In0.eyJleHAiOjE3Nzc1MjcxNDksImlhdCI6MTc3NzUyNjg0OSwianRpIjoib25ydHJvOjdhODhiN2NjLWE5NGYtNGZjNC05NDJjLWVkOWFjMjhmYzRhNyIsImlzcyI6Imh0dHA6Ly9sb2NhbGhvc3Q6ODA4MC9yZWFsbXMvZ2VzdGFsb2thIiwic3ViIjoic3dhcm0tYy1zdWIiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJnZXN0YWxva2EtZnJvbnRlbmQiLCJzaWQiOiIxM2EzZjdiNy00NTBiLTQ3YzYtOWEzZC0xM2U3YjBkZjdiMTEiLCJhY3IiOiIxIiwiYWxsb3dlZC1vcmlnaW5zIjpbImh0dHA6Ly9sb2NhbGhvc3Q6NTE3MyJdLCJzY29wZSI6InByb2ZpbGUgZW1haWwiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwibmFtZSI6IlN3YXJtIEMiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJzd2FybS1jIiwiZ2l2ZW5fbmFtZSI6IlN3YXJtIiwiZmFtaWx5X25hbWUiOiJDIiwiZW1haWwiOiJzd2FybS1jQGV4YW1wbGUuY29tIn0.cLPPh6Srz86LszKvWEXsZZx0UOF-0BQZwlDze9HDAo3dL7Kyt55isC20DNcuGem93uEjw0pwhzvHHIHFq-S1ICH-BaPLQ_aYRlV1MPY3QWz3efw7hDjNlwpVQD3SbJtZJzUSVC7Rjexia_NGcjbQ4D1pSo3Y5yojIN3Mi5v2ziPApvhsRC-X5lzxjwDceRM697TmpPZIRWY_rzyHgzbIva_KBGhf8GgkuU6KUnd18F8grhu_e8z76tbBgNi3sS_n6NAYdcOCd5jW9MVz8kV0a17NyFbGnnu9ybvrk0lJ5p6XjllCu4P-lqH2bO4r6gr-xQPQ_98hHNX6XTCzX7xzDw[22m
[2m    - content-type: application/json[22m
[2m    - content-length: 91[22m


### raid-planner

- 最新評価: ブロック
- 最新観測: swarm-test stopped before hard checks at resource_conflict_turns.
- attempt-1: 評価=ブロック; 観測=swarm-test stopped before hard checks at resource_conflict_turns.; 証跡=apiRequestContext.post: Timeout 60000ms exceeded.
Call log:
[2m  - → POST http://localhost:8000/sessions[22m
[2m    - user-agent: Playwright/1.59.1 (x64; ubuntu 24.04) node/24.14 CI/1[22m
[2m    - accept: */*[22m
[2m    - accept-encoding: gzip,deflate,br[22m
[2m    - Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJoSjMtZzZXT3RXOVAyWGI3eE9adDlmQlB6QnJ2Mk1SeWdxOUZ2ckRwV3h3In0.eyJleHAiOjE3Nzc1MjcxNDksImlhdCI6MTc3NzUyNjg0OSwianRpIjoib25ydHJvOjdhODhiN2NjLWE5NGYtNGZjNC05NDJjLWVkOWFjMjhmYzRhNyIsImlzcyI6Imh0dHA6Ly9sb2NhbGhvc3Q6ODA4MC9yZWFsbXMvZ2VzdGFsb2thIiwic3ViIjoic3dhcm0tYy1zdWIiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJnZXN0YWxva2EtZnJvbnRlbmQiLCJzaWQiOiIxM2EzZjdiNy00NTBiLTQ3YzYtOWEzZC0xM2U3YjBkZjdiMTEiLCJhY3IiOiIxIiwiYWxsb3dlZC1vcmlnaW5zIjpbImh0dHA6Ly9sb2NhbGhvc3Q6NTE3MyJdLCJzY29wZSI6InByb2ZpbGUgZW1haWwiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwibmFtZSI6IlN3YXJtIEMiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJzd2FybS1jIiwiZ2l2ZW5fbmFtZSI6IlN3YXJtIiwiZmFtaWx5X25hbWUiOiJDIiwiZW1haWwiOiJzd2FybS1jQGV4YW1wbGUuY29tIn0.cLPPh6Srz86LszKvWEXsZZx0UOF-0BQZwlDze9HDAo3dL7Kyt55isC20DNcuGem93uEjw0pwhzvHHIHFq-S1ICH-BaPLQ_aYRlV1MPY3QWz3efw7hDjNlwpVQD3SbJtZJzUSVC7Rjexia_NGcjbQ4D1pSo3Y5yojIN3Mi5v2ziPApvhsRC-X5lzxjwDceRM697TmpPZIRWY_rzyHgzbIva_KBGhf8GgkuU6KUnd18F8grhu_e8z76tbBgNi3sS_n6NAYdcOCd5jW9MVz8kV0a17NyFbGnnu9ybvrk0lJ5p6XjllCu4P-lqH2bO4r6gr-xQPQ_98hHNX6XTCzX7xzDw[22m
[2m    - content-type: application/json[22m
[2m    - content-length: 91[22m


### causality-engineer

- 最新評価: ブロック
- 最新観測: swarm-test stopped before hard checks at resource_conflict_turns.
- attempt-1: 評価=ブロック; 観測=swarm-test stopped before hard checks at resource_conflict_turns.; 証跡=apiRequestContext.post: Timeout 60000ms exceeded.
Call log:
[2m  - → POST http://localhost:8000/sessions[22m
[2m    - user-agent: Playwright/1.59.1 (x64; ubuntu 24.04) node/24.14 CI/1[22m
[2m    - accept: */*[22m
[2m    - accept-encoding: gzip,deflate,br[22m
[2m    - Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJoSjMtZzZXT3RXOVAyWGI3eE9adDlmQlB6QnJ2Mk1SeWdxOUZ2ckRwV3h3In0.eyJleHAiOjE3Nzc1MjcxNDksImlhdCI6MTc3NzUyNjg0OSwianRpIjoib25ydHJvOjdhODhiN2NjLWE5NGYtNGZjNC05NDJjLWVkOWFjMjhmYzRhNyIsImlzcyI6Imh0dHA6Ly9sb2NhbGhvc3Q6ODA4MC9yZWFsbXMvZ2VzdGFsb2thIiwic3ViIjoic3dhcm0tYy1zdWIiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJnZXN0YWxva2EtZnJvbnRlbmQiLCJzaWQiOiIxM2EzZjdiNy00NTBiLTQ3YzYtOWEzZC0xM2U3YjBkZjdiMTEiLCJhY3IiOiIxIiwiYWxsb3dlZC1vcmlnaW5zIjpbImh0dHA6Ly9sb2NhbGhvc3Q6NTE3MyJdLCJzY29wZSI6InByb2ZpbGUgZW1haWwiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwibmFtZSI6IlN3YXJtIEMiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJzd2FybS1jIiwiZ2l2ZW5fbmFtZSI6IlN3YXJtIiwiZmFtaWx5X25hbWUiOiJDIiwiZW1haWwiOiJzd2FybS1jQGV4YW1wbGUuY29tIn0.cLPPh6Srz86LszKvWEXsZZx0UOF-0BQZwlDze9HDAo3dL7Kyt55isC20DNcuGem93uEjw0pwhzvHHIHFq-S1ICH-BaPLQ_aYRlV1MPY3QWz3efw7hDjNlwpVQD3SbJtZJzUSVC7Rjexia_NGcjbQ4D1pSo3Y5yojIN3Mi5v2ziPApvhsRC-X5lzxjwDceRM697TmpPZIRWY_rzyHgzbIva_KBGhf8GgkuU6KUnd18F8grhu_e8z76tbBgNi3sS_n6NAYdcOCd5jW9MVz8kV0a17NyFbGnnu9ybvrk0lJ5p6XjllCu4P-lqH2bO4r6gr-xQPQ_98hHNX6XTCzX7xzDw[22m
[2m    - content-type: application/json[22m
[2m    - content-length: 91[22m


## 個別レポート

- attempt-1: swarm-test-report-attempt-1.md, swarm-test-result-attempt-1.json

