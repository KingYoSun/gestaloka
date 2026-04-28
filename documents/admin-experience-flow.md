# Admin Experience Flow

Admin UI の正本。Admin は管理画面であり、debug 画面ではない。

## 原則

- Admin は運用管理のための画面である。
- Admin に debug 情報を常時表示しない。
- Player と Admin はアーキテクチャレベルで分離する。
- Player の内部状態を Admin の都合で露出しない。

## Admin の責務

Admin が扱うもの:

- pack の導入
- pack の作成
- pack の公開状態管理
- world template 管理
- ユーザー管理
- 権限管理
- LLM API 設定
- model lane 設定
- prompt 設定
- SP など運用上必要な管理
- release / deployment に必要な管理操作

Admin は、現在ハードコードされている運用要素を動的に管理するためのフロントエンドである。

## Admin に出さないもの

Admin に以下を通常表示しない。

- Player の raw runtime dump
- raw JSON payload
- raw event stream
- raw memory dump
- raw projection internals
- その場の実装確認だけを目的にした値
- 開発者向け trace の垂れ流し
- テストのためだけの表示

## Settings の責務

設定画面が扱うもの:

- LLM provider 設定
- API key 設定
- prompt 設定
- model lane 設定

## Acceptance Checklist

- Admin の通常画面が debug dump になっていない。
- Admin の主要導線が管理操作になっている。
- pack / user / LLM / prompt / model 設定が Admin の対象として整理されている。
- debug 情報は設定で明示的に有効化する設計になっている。
- debug 情報は Admin 通常画面ではなく Player debug surface に出る。
- Player と Admin の責務が混ざっていない。
