# AGENTS.md（小説執筆：常設指示 / Codex向け）
最終更新: 2026-01-20

> 対象: このリポジトリの `novel/` 配下で作業するAI（Codex拡張/CLI含む）
> 目的: 小説版『ゲスタロカ』の執筆・推敲・整合性維持を、ファイルベースで破綻なく進める

---

## 0. 作業範囲
- 原則として **`novel/` 配下のみ**を編集対象とする。
- 参照は許可: `documents/03_worldbuilding/` および `documents/03_worldbuilding/game_mechanics/`
  - ただし、参照内容をそのまま本文へ貼り付けず「小説描写」に翻訳する。

---

## 1. ファイルの役割（必ず守る）
### 設定（Canon）
- `novel/canon/WORLD_BIBLE.md` : 読者に提示する表層設定（ネタバレは書かない）
- `novel/canon/CANON_RULES.md` : 禁則・確定事項（ブレ防止の最優先）
- `novel/canon/GLOSSARY.md` : 用語の表記・読みの正（表記ゆれ禁止）
- `novel/canon/FACTIONS.md` : 勢力の目的/手段/対立軸
- `novel/canon/LORE_SECRETS.md` : 作者用ネタバレ隔離（本文へ直出し禁止）

### 物語（Story）
- `novel/story/outline/` : アーク/章割り（設計図）
- `novel/story/drafts/` : 下書き（自由に直す）
- `novel/story/manuscript/` : 確定稿（移動/昇格は慎重に）

### 運用（Ops）
- `novel/ops/STYLE_GUIDE.md` : 文体・視点ルール（本文は必ず準拠）
- `novel/ops/CHAPTER_BRIEF.md` : 章ブリーフのテンプレ
- `novel/ops/briefs/` : 章ブリーフ置き場（例: `briefs/ch01.md`）
- `novel/ops/TASKS.md` : TODO（基本はここから消化）

### ログ（Logs）
- `novel/logs/ai_sessions/YYYY-MM-DD.md` : AI作業の要点ログ（作業後に更新）

---

## 2. 参照優先順位（衝突したら上を採用）
1) `novel/canon/CANON_RULES.md`
2) `novel/ops/STYLE_GUIDE.md`
3) `novel/canon/GLOSSARY.md`
4) `novel/canon/WORLD_BIBLE.md`
5) `novel/canon/FACTIONS.md`
6) `novel/story/outline/*`
7) `novel/canon/LORE_SECRETS.md`（※作者用。本文に漏らさない）

---

## 3. 絶対禁止（破ると世界観が壊れる）
- **ゲームUI/数値**を地の文に出す（SP残量、ステータス画面、確率、レアリティ表示 等）
- 用語の意味や表記を章ごとに変える（新解釈が必要ならCanonを更新してから）
- 遺物/スキルで「便利すぎる解決」を連発（必ず制約・代償・政治的リスク）
- ログや称号を「ただのアイテム/肩書き」扱いに矮小化（重みと副作用を付ける）
- `LORE_SECRETS.md` の内容（世界の人工性/真実）を **本文で断定的に開示**する
  - ARC 01では「匂わせ」止まり（図形、規格、反復、文字化け、音欠落など）

---

## 4. 文体・視点（執筆時のデフォルト）
- ルールは `novel/ops/STYLE_GUIDE.md` に全面準拠
- 原則:
  - **一人称（主人公視点）**
  - **過去形**（〜した／〜だった）
  - 主人公が知り得ない情報は書かない（他者の内心断定禁止）
  - 固有名詞・概念は『』、セリフは「」
  - 説明は溜めず、会話・行動・掲示物・噂・記憶の断片として散らす
  - 数値の代わりに体感で限界を表現（息切れ、耳鳴り、視界ノイズ等）

---

## 5. 作業プロトコル（Codexに依頼するときの型）

### 5.1 章を書く（または大改稿する）とき
必ずこの順で進める:
1) `novel/story/outline/ARC_01.md`（該当アーク）と既存の章ファイルを読む
2) `novel/ops/CHAPTER_BRIEF.md` を複製し、`novel/ops/briefs/chNN.md` を作る
3) `novel/story/drafts/chNN.md` を執筆/改稿する
4) 作業後に必ず以下を更新（必要があれば）:
   - 新語/表記ゆれ → `novel/canon/GLOSSARY.md`
   - 新勢力の言動/目的 → `novel/canon/FACTIONS.md`
   - 禁則・確定事項の追加 → `novel/canon/CANON_RULES.md`
   - ネタバレ級の決定/伏線メモ → `novel/canon/LORE_SECRETS.md`（作者用）
5) `novel/logs/ai_sessions/YYYY-MM-DD.md` に「やったこと/決まったこと/宿題」を追記

### 5.2 下書きを確定稿へ昇格するとき
- `drafts/chNN.md` の内容を整理して `manuscript/chNN.md` へ移す（`.gitkeep` は残す）
- 昇格時は以下のチェックを必ず通す:
  - 視点違反がない（神視点説明、内心断定）
  - UI/数値が混入していない
  - 用語の表記が `GLOSSARY.md` と一致
  - 勢力の振る舞いが `FACTIONS.md` と矛盾しない
  - ネタバレの断定がない（開示計画に反していない）

---

## 6. 依頼を受けたときの「出力フォーマット」
あなた（AI）は、ファイル編集だけでなく、必ず回答に以下を含める:

1) **作業サマリ（3〜8行）**
2) **変更したファイル一覧**
3) **新規に追加/変更した用語（あれば）**
4) **矛盾/懸念点（あれば）**と、解消案（1〜3個）
5) **次の一手（TASKSに起票すべきこと）**

---

## 7. “ゲスタロカ”小説版の核（ブレ防止メモ）
- 世界の表層: 階層世界、昇降塔、界壁、企業国家、魔結晶経済、汚染/歪み
- 物語装置: 残響（ログ）、記憶フラグメント、編纂、称号、浄化と代償
- 裏の真実（作者用）: `LORE_SECRETS.md` に隔離し、段階的に匂わせる
