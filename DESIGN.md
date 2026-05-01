# GESTALOKA v2 Design Rules

> GESTALOKA v2 のフロントエンド視覚設計ルール。
> 色、文字、余白、幅、影、レスポンシブの数値は原則としてこの文書の値を使い、実装では CSS Custom Properties へ集約する。

---

## 1. Visual Theme & Atmosphere

- **デザイン方針**: `designs/design.png` の Living World Spiral を基準にした、生成りの紙面に物語が浮かぶブランド体験。物語、選択肢、ログ、履歴、管理情報が主役になるよう、装飾はロゴ・線・質感に限定する。
- **密度**: 物語本文はゆったり、管理画面や ops 表示は密度を上げすぎず、スキャンしやすい余白を保つ。
- **キーワード**: 読みやすい、温かい、紙質感、共有世界、記憶、成長、長時間読んでも疲れにくい。
- **特徴**: 通常モードは cream / warm off-white を面背景に使う。navy は本文、ロゴ、細線、アイコンなどの前景用途に限定し、通常モードのページ、section、card、hero、button fill など大面積背景には使わない。ダークモードでは navy を背景色の基準にする。

---

## 2. Color Palette & Roles

### Brand（Living World Spiral）

- **Navy** (`#0b2034`): ロゴ、本文、細線、アイコン。通常モードでは面背景に使わない。ダークモード背景の基準色。
- **Gold** (`#c6922e`): primary CTA、短い下線、重要なアクセント、選択中状態。
- **Sage** (`#65785f`): セカンダリテキスト、補助見出し、穏やかな状態表示。
- **Cream** (`#f2eadf`): 通常モードのページ背景、first view 背景、紙質感の基準。旧 Brand White の役割を置き換える。
- **Aqua** (`#7bcfd0`): story-seed の差し色、フォーカス補助、軽い強調。広い背景や本文色には使わない。

### Semantic（意味的な色）

- **Success** — surface: `#65785f`, text: `#51654d`, subdued: `#eef3e9`
- **Danger** — surface: `#b22323`, text: `#b22323`, subdued: `#fdf3f3`
- **Caution** — surface: `#c6922e`, text: `#8d641d`, subdued: `#fbf0d7`
- **Like / Positive Reaction** — surface: `#d13e5c`, text: `#d13e5c`
- **Offer / Highlight Reaction** — surface: `#d13e5c`, text: `#d13e5c`
- **Badge** (`#d53c21`): 通知バッジ、未処理件数など
- **Point** — text: `#c6922e`

### Neutral — Gray Scale

- **Navy 900** (`#0b2034`): 本文テキスト、ロゴ、強い線
- **Navy 800** (`#12304a`): ダークモードカード、濃い補助面
- **Sage 700** (`#65785f`): セカンダリテキスト、補助線
- **Sage 500** (`#8b9a84`): 薄いテキスト、プレースホルダー
- **Cream 100** (`#f2eadf`): ページ背景
- **Off-white 100** (`#f8f2e8`): カード、フォーム面
- **Off-white 200** (`#e6d8c5`): ボーダー、区切り

### Text（テキスト色）

- **Text Primary** (`#0b2034`): 本文テキスト。ダーク: `hsla(38,62%,93%,0.92)`
- **Text Secondary** (`#65785f`): 補足テキスト。ダーク: `hsla(38,62%,93%,0.70)`
- **Text Clickable Icon** (`rgba(11,32,52,0.62)`): クリック可能アイコン
- **Text Disabled** (`rgba(11,32,52,0.44)`): 無効テキスト
- **Text Invert** (`#ffffff`): 反転テキスト（暗い背景上）
- **Text Placeholder** (`#8b9a84`): プレースホルダー

### Surface & Borders

- **Background Primary** (`#f2eadf`): 通常モードのページ背景
- **Background Secondary** (`#f8f2e8`): セクション背景、フォーム背景
- **Background Texture** (`/brand/texture.png`): 通常モードの紙質感。モノクロ texture を Cream 背景へ `background-blend-mode: multiply` で混ぜ、文字の可読性を優先する。
- **Dark Background** (`#0b2034`): ダークモード背景
- **Surface Normal** (`#fffaf1`): カード等の面
- **Surface Primary** (`#c6922e`): プライマリ CTA。通常モードで navy の塗り CTA は使わない。
- **Surface Secondary** (`#f8f2e8`): セカンダリ面
- **Surface Tertiary** (`#e6d8c5`): 第三階層面
- **Surface Quaternary** (`#f2eadf`): 第四階層面
- **Surface Invert** (`#0b2034`): ダークモードまたは reverse lockup 専用
- **Surface Clear** (`hsla(0,0%,100%,0)`): 透明面
- **Border Default** (`rgba(11,32,52,0.16)`): 標準ボーダー
- **Border Strong** (`rgba(11,32,52,0.26)`): 強いボーダー
- **Border Weak** (`rgba(198,146,46,0.24)`): 弱い装飾線
- **Border Primary** (`#c6922e`): プライマリボーダー
- **Border Focus** (`#7bcfd0`): フォーカスリング
- **Border Invert** (`#fff`): 反転ボーダー

### Accent / Action

- **Custom Accent** (`#c6922e`): CTA（ライトモード）
- **Disabled** (`rgba(0,0,0,0.14)`): 無効状態の面

---

## 3. Typography Rules

### 3.1 和文フォント

**ゴシック体（デフォルト）**:
- ヒラギノ角ゴ ProN（macOS）
- Noto Sans JP（Windows フォールバック）
- メイリオ（Windows 追加フォールバック）

**明朝体（物語本文のオプション）**:
- ヒラギノ明朝 ProN / Pro（macOS）
- BIZ UDPMincho（Windows）
- 游明朝 / Yu Mincho（クロスプラットフォーム）
- MS PMincho（レガシー Windows）

### 3.2 欧文フォント

- **サンセリフ**: Helvetica Neue, Arial
- **セリフ**: 明朝体フォールバック内で対応
- **等幅**: SFMono-Regular, Consolas, Menlo, Courier
- **数字専用**: Open Sans（数字の可読性向上）

### 3.3 font-family 指定

```css
/* デフォルト（ゴシック体） */
font-family: "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN",
  Arial, "Noto Sans JP", Meiryo, sans-serif;

/* 明朝体（物語本文オプション） */
font-family: "Hiragino Mincho ProN", "Hiragino Mincho Pro", HGSMinchoE,
  "Yu Mincho", YuMincho, "MS PMincho", serif;

/* 等幅 */
font-family: SFMono-Regular, Consolas, Menlo, Courier, monospace;

/* 欧文のみ */
font-family: "Helvetica Neue", Arial;

/* 数字専用 */
font-family: "Open Sans", sans-serif;

/* 絵文字対応 */
font-family: PrimaryEmojiFont, "Helvetica Neue", "Hiragino Kaku Gothic ProN",
  "Hiragino Sans", "Apple Color Emoji", "noto color emoji", Arial,
  "Segoe UI Emoji", "Segoe UI Symbol", Meiryo, sans-serif;

/* Windows（YakuHan 約物フォント対応） */
font-family: YakuHanJPs, Arial, Meiryo, sans-serif;

/* Windows 明朝体（YakuHan 対応） */
font-family: YakuHanMPs, "BIZ UDPMincho", "Yu Mincho", YuMincho,
  "MS PMincho", serif;
```

**フォールバックの考え方**:
- 欧文フォント（Helvetica Neue）を先に指定し、欧文の表示品質を優先する。
- macOS の和文フォント（ヒラギノ）→ Windows の和文フォント（Noto Sans JP, メイリオ）の順にする。
- 明朝体は物語本文のオプションとして別スタックを用意する。
- YakuHan フォントで約物の幅を半角に揃えるオプションを持てる。
- 数字専用の Open Sans スタックで、数値表示の可読性を向上できる。

### 3.4 文字サイズ・ウェイト階層

**物語・読み物ページ**

| Role | Size | Weight | Line Height | Letter Spacing | palt | 用途 |
|------|------|--------|-------------|----------------|------|------|
| Narrative Title (h1) | 32px | 700 | 48px (x1.5) | 1.28px (0.04em) | あり | シーン、章、世界説明の大見出し |
| Heading 2 | 28px | 700 | 36px (x1.286) | 1.12px (0.04em) | あり | セクション見出し |
| Body (p) | 18px | 400 | 36px (x2.0) | normal | なし | 物語本文、長文ログ |
| Input | 14px | 400 | 21px (x1.5) | normal | なし | 検索欄、短い入力欄 |

**アプリ・管理画面**

| Role | Size | Weight | Line Height | Letter Spacing | palt | 用途 |
|------|------|--------|-------------|----------------|------|------|
| Heading 2 | 16px | 600 | 24px (x1.5) | normal | なし | セクション見出し |
| Heading 3 | 16px | 600 | 24px (x1.5) | 0.64px (0.04em) | あり | カード見出し、パネル見出し |
| Caption (p) | 12px | 600 | 18px (x1.5) | normal | なし | 補助テキスト、メタ情報 |
| Button | 16px | 400 | 24px (x1.5) | normal | なし | ボタン |
| Input | 14px | 400 | 21px (x1.5) | normal | なし | 検索欄、フォーム |

### 3.5 行間・字間

**行間 (line-height)**:
- body グローバル: `24px` (16px x 1.5)
- 物語本文 (p): `36px` (18px x **2.0**) — 読み物コンテンツのため非常にゆったり
- 大見出し (h1): `48px` (32px x 1.5)
- h2: `36px` (28px x 1.286)
- UI テキスト: `24px` (16px x 1.5)

**字間 (letter-spacing)**:
- 本文 (p): `normal`
- 大見出し (h1): `1.28px` (= 0.04em) — **見出し専用**
- h2: `1.12px` (= 0.04em) — **見出し専用**
- アプリ h3: `0.64px` (= 0.04em) — **見出し専用**
- body / button / input / a: `normal`

**ガイドライン**:
- `letter-spacing: 0.04em` と `palt` は**見出し専用**。本文には適用しない。
- 物語本文、選択肢説明、ログ、履歴は `font-size: 18px` + `line-height: 2.0` を優先する。
- 管理画面は 16px / 1.5 を基準にし、ボーダーと余白で情報を分ける。

### 3.6 禁則処理・改行ルール

```css
/* グローバル設定（<body>） */
word-wrap: break-word;

/* フォントレンダリング */
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
font-kerning: auto;
```

- `word-wrap: break-word` をグローバルに適用し、長い URL、ID、英単語、生成テキストの折り返しに対応する。
- フォントスムージングを有効にし、macOS での表示品質を向上する。

### 3.7 OpenType 機能

```css
/* 見出し (h1, h2, app h3) にのみ適用 */
font-feature-settings: "palt";

/* 本文 (p), body, button, input, a には適用しない */
font-feature-settings: normal;
```

- **palt**: 和文のプロポーショナル字詰め。**見出し要素にのみ適用**する。
- 本文への palt 適用は避ける。長文の読みやすさと文字送りの安定を優先する。
- CSS Custom Property `--font-feature-settings-palt` として定義し、適用先を限定する。

### 3.8 縦書き

- GESTALOKA v2 の標準 UI は横書きのみ。
- 将来、物語演出で縦書きを導入する場合も、この文書の標準レイアウトとは別ルールとして扱う。

---

## 4. Component Stylings

### Buttons

**Primary（CTA）**
- Background: `#c6922e`（ライトモード）
- Text: `#0b2034`
- Border Radius: 適度な角丸
- Font Size: 1rem (16px)
- Font Weight: 700
- 通常モードでは navy 塗りの CTA を使わない。navy はテキスト、ロゴ、細線、アイコンに限定する。

**Reaction / Positive Button**
- Active Color: `#d13e5c`
- Text: `#d13e5c`

### Cards / Panels

- Background: `#fffaf1`
- Border: `rgba(11,32,52,0.16)`
- Border Radius: 12px
- Shadow: `--elevation-1`（下記参照）
- 物語本文を入れるカードは幅を広げすぎず、本文の可読幅を優先する。
- 管理画面のパネルはカードを入れ子にせず、境界線と見出しで情報を整理する。

### Navigation

- Background: `#f2eadf`
- Border Bottom: `rgba(11,32,52,0.16)`
- Height: 64px（デスクトップ）/ 48px（モバイル）
- グローバルな導線は短いラベルと安定した配置を優先し、物語本文の読書を妨げない。

### First View / Brand Lockup

- 背景は cream / warm off-white と `texture.png` の紙質感を使い、navy の大面積背景は禁止する。通常モードのページ背景では Cream とモノクロ texture を blend して表示する。
- 中央に `logo.png`、lowercase の `gestaloka`、`SHARED WORLD. LIVED STORIES` を縦積みにする。
- CTA はロゴ下に配置し、primary は gold、secondary は生成り/透明系にする。
- ロゴは通常モードでは `logo.png` をそのまま使い、ダークモードでは同じロゴを reverse lockup の前景として扱う。

---

## 5. Layout Principles

### Content Width

| Area | Width | 用途 |
|------|-------|------|
| Main Content | 940px | メインコンテンツ幅 |
| Reading / Narrative | 620px | 物語本文、世界説明、長文ログ |
| Timeline | 580px | イベント、履歴、フィード |
| Editor | 580px | 入力、プロンプト編集、長文フォーム |
| Two-Column Main | 610px | 2カラムレイアウトのメイン |
| Two-Column Sub | 280px | 2カラムレイアウトのサイドバー |

### Spacing

- Tailwind CSS のデフォルトスペーシングスケール（4px ベース）を基準にする。
- 物語本文、選択肢、ログ、履歴は行間と上下余白を削りすぎない。
- ops 表示は情報密度よりも誤読しにくさを優先し、区切り線、余白、見出しで整理する。

---

## 6. Depth & Elevation

| Level | Shadow | 用途 |
|-------|--------|------|
| `--elevation-1` | `0px 1px 3px 1px rgba(0,0,0,0.14), 0px 1px 2px 0px rgba(0,0,0,0.22)` | カード、パネル |
| `--elevation-4` | `0px 4px 8px 3px rgba(0,0,0,0.14), 0px 1px 3px 0px rgba(0,0,0,0.22)` | ドロップダウン |
| `--elevation-6` | `0px 6px 10px 4px rgba(0,0,0,0.14), 0px 2px 3px 0px rgba(0,0,0,0.22)` | モーダル、ダイアログ |

- すべてデュアルシャドウ（ambient light + key light）構成。
- ambient: `rgba(0,0,0,0.14)` = `--color-blackAlpha-100`
- key: `rgba(0,0,0,0.22)` = `--color-blackAlpha-200`
- hover / reaction 時のオーバーレイ: `rgba(8,19,26,0.03)` = `--color-grayAlpha-50`
- 読ませる領域では影を強くしすぎず、本文と境界のコントラストで階層を作る。

---

## 7. GESTALOKA Application Rules

### Do（推奨）

- テキスト色は `#0b2034`（navy）を使い、純粋な `#000000` を避ける。
- 通常モードの背景は cream / warm off-white 系を使い、紙質感を薄く重ねる。
- セカンダリテキストは `#65785f` を基準に表現する。
- 物語本文は `font-size: 18px` + `line-height: 2.0` で組む。
- 物語本文、選択肢、ログ、履歴などの読ませる領域は 620px 前後の可読幅を優先する。
- `letter-spacing: 0.04em` と `palt` は**見出し (h1, h2, app h3) にのみ**適用する。
- 明朝体オプションを提供する場合は、完全な明朝体フォールバックチェーンを使う。
- ダークモードでは navy `#0b2034` を背景色の基準にし、全色を CSS Custom Properties で切り替える。
- 管理画面や ops 表示でも同じ色トークン、ボーダー、余白ルールを使う。

### Don't（禁止）

- 純粋な `#000000` を通常本文に使わない。
- 通常モードで navy `#0b2034` をページ、section、card、hero、button fill などの面背景に使わない。
- 物語本文の可読幅を不用意に 620px 以上へ広げない。
- aqua `#7bcfd0` を広い本文や低コントラストなテキストに使わない。
- ゴシック体と明朝体を同じ文章内で混ぜない。
- `letter-spacing: 0.04em` や `palt` を本文 (p) に適用しない。
- 色値をコンポーネント内へ散らさず、CSS Custom Properties への集約を優先する。
- 装飾的なカードの入れ子で情報階層を作らない。

---

## 8. Responsive Behavior

### Breakpoints

| Name | Width | 説明 |
|------|-------|------|
| XS | 361px | 狭いモバイル |
| SM | 481px | モバイル |
| MD | 769px | タブレット |
| LG | 941px | 小さいデスクトップ |
| XL | 1280px | デスクトップ |
| 2XL | <= 2048px | 大画面 |

### タッチターゲット

- 最小サイズ: 44px x 44px

### Dark Mode

- 初回表示は `prefers-color-scheme: dark` を読み、`light | dark` の 2 択へ正規化する。
- ユーザー操作後は localStorage key `gestaloka.theme` を正とし、`theme-light` または `theme-dark` を `<html>` に付与する。
- 切替 UI は言語切替の横に置くアイコンボタンとし、`Sun` / `Moon` を使う。表示テキストは出さず、`aria-label` と `sr-only` で意味を提供する。
- `theme-dark` は REVERSE LOCKUP として扱い、navy `#0b2034` 背景、off-white 系文字、gold / aqua accent を維持する。
- `theme-light` は OS が dark の場合でも通常モードの cream + texture 背景を明示的に上書きする。
- すべてのセマンティックカラーを CSS Custom Properties で切り替える。
- ライト / ダークのどちらでも、本文の可読性とフォーカスリングの視認性を維持する。

---

## 9. Agent Prompt Guide

### クイックリファレンス

```text
Brand Navy: #0b2034（通常モードは前景用、ダークモード背景用）
Brand Gold: #c6922e（CTA・アクセント用）
Brand Sage: #65785f（補助テキスト・状態用）
Brand Cream: #f2eadf（通常モード背景用。旧 Brand White）
Brand Aqua: #7bcfd0（focus・軽い差し色用）
CTA Background: #c6922e（ライトモード）
Text Primary: #0b2034
Text Secondary: #65785f
Background: #f2eadf
Background Secondary: #f8f2e8
Card: #fffaf1
Border: rgba(11,32,52,0.16)
Reaction Color: #d13e5c
Danger: #b22323
Success: #65785f
Focus Ring: #7bcfd0

Sans-Serif Font: "Helvetica Neue", "Hiragino Sans",
  "Hiragino Kaku Gothic ProN", Arial, "Noto Sans JP", Meiryo, sans-serif
Serif Font: "Hiragino Mincho ProN", "Hiragino Mincho Pro", HGSMinchoE,
  "Yu Mincho", YuMincho, "MS PMincho", serif

Body Size (app): 16px / line-height: 1.5 / letter-spacing: normal
Body Size (narrative): 18px / line-height: 2.0 / letter-spacing: normal
Heading: letter-spacing: 0.04em + font-feature-settings: "palt"
Reading Width: 620px
```

### 実装時の短い指示例

```text
GESTALOKA v2 の DESIGN.md に従って、物語本文と選択肢の UI を調整してください。
- フォント: "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN",
    Arial, "Noto Sans JP", Meiryo, sans-serif
- テキスト色: #0b2034（通常本文に純粋な黒は使わない）
- セカンダリテキスト: #65785f
- 背景: #f2eadf、セクション背景: #f8f2e8、カード: #fffaf1
- ボーダー: rgba(11,32,52,0.16)
- 通常モードでは navy #0b2034 を面背景に使わない
- 読ませる領域: 620px 前後
- 物語本文: 18px, line-height: 2.0, letter-spacing: normal
- 見出し: letter-spacing: 0.04em, font-feature-settings: "palt"
- ダークモード対応: navy #0b2034 を背景基準に CSS Custom Properties で色を切り替え
```
