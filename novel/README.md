# 小説プロジェクト（ゲスタロカ）

最終更新: 2026-01-20

このリポジトリの世界観設定（`documents/03_worldbuilding/`）をベースに、同一世界観で小説を書くための作業領域です。

## ディレクトリ構成

- `canon/`: 設定の確定・用語・勢力・禁則
- `story/`: 物語（アウトライン→下書き→確定稿）
- `ops/`: 執筆運用（章ブリーフ、文体、TODO）
- `logs/`: AI支援セッションの要点ログ

## 推奨フロー

1. `novel/ops/TASKS.md` の「Now」を消化
2. 章ごとに `novel/ops/CHAPTER_BRIEF.md` を複製してブリーフを作る（例: `novel/ops/briefs/ch01.md`）
3. `novel/story/drafts/chNN.md` に下書きを書く
4. 固まったら `novel/story/manuscript/` に確定稿として移す
5. 新語・新設定が出たら `novel/canon/GLOSSARY.md` と `novel/canon/CANON_RULES.md` を更新
6. ネタバレは `novel/canon/LORE_SECRETS.md` に隔離
7. AIを使ったら `novel/logs/ai_sessions/YYYY-MM-DD.md` に要点を記録

