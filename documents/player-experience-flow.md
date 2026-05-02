# Player Experience Flow

Player UI の正本。実装時はこの文書の allowlist を優先し、説明文を足して補わない。

## 原則

- UI は説明しない。ユーザーが次に押すもの、読むもの、結果として見るものだけを出す。
- 「念のため見せる」「状態があるから出す」「テストで使うから見せる」は禁止する。
- Player はプレイ画面であり、診断画面ではない。
- Admin も debug 画面ではない。Admin の責務は `admin-experience-flow.md` を参照する。
- 迷ったら表示しない。必要になった時だけ、最短のラベルで出す。

## Copy Budget

| 状態 | 表示文量 |
|------|----------|
| First View | ヘッダーの `gestaloka` と 2 ボタンのみ |
| 認証後・未開始 | `ワールドを選択`、world card、character card、直接操作ボタン |
| プレイ中 | 場面本文、選択肢、結果差分 |
| エラー | 1 文。原因説明や復旧手順を長く書かない |
| Admin | 診断に必要なラベルと値のみ |

本文を追加する前に、ボタン、見出し、状態ラベルだけで成立するか確認する。

## First View Contract

First View の基本レイアウトは三要素だけにする。

- ヘッダー: `gestaloka`
- 主操作: `ログインして続ける`
- 副操作: `アカウントを作成して始める`

First View に出さないもの:

- hero headline
- 世界説明
- API / Socket / SP / catalog status
- 無効な sign-out
- onboarding text
- テスト用の状態表示
- 診断値

## Primary Flow

1. 未ログイン
2. 認証後
3. ワールド選択
4. キャラクター選択または作成
5. 開始
6. 場面を読む
7. 選ぶ
8. 結果を見る
9. 次を選ぶ

各状態は、次の行動がひとつに見えることを優先する。

## Minimum Visible Information

### 未ログイン

表示してよいもの:

- ヘッダーの `gestaloka`
- `ログインして続ける`
- `アカウントを作成して始める`

表示しないもの:

- 説明文
- status row
- world preview
- SP
- API health
- catalog
- Admin 導線

### 認証後・未開始

表示してよいもの:

- ヘッダーの `gestaloka`
- `ワールドを選択`
- world card: display name, summary
- `キャラクター作成に進む`
- `キャラクター選択に進む`
- character card: アイコン画像、名前、性別、背景、自由記述、文体設定、プレイ言語設定
- `book-plus` のキャラクター作成導線
- player profile form
- 任意の正方形アイコン画像
- `始める`
- 選択中の世界名
- 必要な場合のみ SP 残量

表示しないもの:

- 本文側の `gestaloka`
- world pack の長い説明
- session ID
- pack ID
- socket state
- API health
- catalog detail
- ops stream

### セッション開始直後

表示してよいもの:

- 現在地
- 章または場面の短い見出し
- 最初の本文
- 次の選択肢
- クエスト進行
- 近くの人物
- 移動先

表示しないもの:

- raw ID
- raw JSON
- projection
- release gate
- eval
- runbook
- ledger 管理

### ターン選択中

表示してよいもの:

- 最新本文
- 選択肢
- 自由入力切替
- クエスト進行
- 変化した所持品または移動先

表示しないもの:

- 過去ログの全件
- backend event type
- memory ID
- relationship raw value
- graph count

### ターン解決中

表示してよいもの:

- 押した選択肢の disabled 状態
- `進行中`

表示しないもの:

- 詳細な処理説明
- model / embedding / retrieval 状態
- retry 手順の長文

### 結果確認

表示してよいもの:

- 最新本文
- NPC reaction
- 変化したクエスト
- 変化した現在地
- 変化した所持品
- 次の選択肢

表示しないもの:

- 全イベント一覧
- 全メモリ一覧
- ops stream
- raw payload

## Forbidden Player Copy

Player UI に以下の説明文を追加しない。

- 「この画面では...」
- 「ここでできることは...」
- 「SP は...」の長文説明
- 「API health」「Socket」「catalog」など内部状態の説明
- 「release」「eval」「projection」「runbook」関連説明
- 実装都合、検証都合、運用都合の文章

必要な情報は、文ではなく短いラベルか値で出す。

## Diagnostics Policy

以下は Player の通常表示から外す。

- API status
- Socket status
- SP cost detail
- catalog status
- ops stream
- raw JSON
- raw ID
- release gate
- eval
- projection
- runbook
- ledger administration

必要な場合は debug mode の対象にする。E2E 維持のためだけに必要な値は hidden test surface に置く。

Admin の通常画面へ debug 情報を移すことは禁止する。Admin は管理画面であり、debug 画面ではない。

## Debug Mode Policy

debug 要素を表示したい場合は、設定画面で debug mode を明示的に有効化する。

debug mode 有効時のみ、Player 画面に debug overlay または debug panel を表示してよい。

debug mode でも First View には debug 情報を表示しない。

debug 情報を Admin 通常画面へ表示しない。Admin の責務は pack、ユーザー、LLM API、prompt、model lane などの管理である。

## Test ID Policy

- 既存 `data-testid` は原則維持する。
- ユーザー体験に不要な `data-testid` は visible UI に置かない。
- hidden test surface は一時的な互換層として許容する。
- 新しい Player UI は test id の都合ではなく、この文書の allowlist で設計する。

## Account Creation Note

First View には `アカウントを作成して始める` を置く。

現時点の Keycloak realm は `registrationAllowed: false` である。実装時に作成導線を有効化する場合は、認証設定側で登録を許可する必要がある。

## Acceptance Checklist

- First View に三要素以外が表示されない。
- 未ログイン状態で説明文が表示されない。
- Player 通常表示に診断値が出ない。
- Admin 通常画面が debug dump になっていない。
- debug 情報は設定で有効化した Player debug surface にだけ表示される。
- プレイ中は本文、選択肢、結果差分が主役になっている。
- 375px mobile で横スクロールしない。
- `DESIGN.md` の読書幅、文字、色 token を守る。
- Shneiderman の 8 golden rules は、説明文の追加ではなく、操作の明確さ、即時フィードバック、不要情報の削減で満たす。
