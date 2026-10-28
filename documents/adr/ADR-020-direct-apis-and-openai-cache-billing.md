# ADR-020: 通常APIへの統一とOpenAIのキャッシュ書込料金

日付: 2026-10-29

状態: 採用

## 背景

ユーザーはClaudeだけに限定する条件を撤回し、GPT-6.1 Terraを含む再選定と、DeepSeek Harnessを経由する実装の削除を依頼した。TerraとSolでは30分・12時間のキャッシュ書込にも料金がかかる。既存の記録方式ではこの内訳が欠けるため、モデル設定・利用量記録・費用明細への追加もユーザーに確認した。

## 決定

DeepSeekも通常のChat Completions APIで呼び出し、結果提案・確定判断・参加生成を共通の世界確定処理へ通す。dsh本体・SDK・起動コード・専用設定・専用CLIを削除する。通常APIではthinkingの有効・無効を明示し、無効時にはreasoning_effortを送らない。推論過程は保存しない。ADR-013・014・015のdsh固有の取り扱いをこの決定で置き換える。

保存済みの世界、receipt、要求・応答、設定版、費用は保持する。廃止した設定項目は読取時に除き、元のDB記録を書き換えない。保存済み要求は、本人が渡したメッセージとroleを照合し、保存された要求とhashで再利用する。新しいAPIの書式を旧要求へ適用し直さない。未確定要求の自動再送防止も維持する。

GPT-6.1 TerraとSolはResponses APIの候補として登録する。OpenAIの新しい応答から料金版3を使い、キャッシュの読取、30分書込、12時間書込、通常入力を分ける。書込は通常入力料金への加算ではなく、その部分を置き換える単価として計算する。内訳の合計が一致しない場合は精算せず、予約を維持する。料金版1・2で始めた応答は従来の計算を保持する。

Responses APIでは実際の入力を事前計数し、最大出力と合わせて予約する。Terra・Solの入力が272,000トークンを超えた場合は、公式仕様に従い要求全体の入力・キャッシュ単価を2倍、出力単価を1.5倍にする。適用した単価を要求と共に保存し、再利用時に変更しない。事前計数に失敗したら生成を送信しない。

Gemini 3.8 Flashの既定単価は、2026年末までの現行料金へ合わせる。将来料金を現時点の実績へ適用しない。個々の保存済み要求・料金は遡及変更しない。今回の再選定結果は別の評価記録とADRへ残す。

公式資料: [Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra)、[Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[OpenAIのキャッシュ](https://developers.openai.com/api/docs/guides/prompt-caching)、[事前計数](https://developers.openai.com/api/docs/guides/token-counting)、[DeepSeekの推論設定](https://api-docs.deepseek.com/guides/thinking_mode/)、[Geminiの料金](https://ai.google.dev/gemini-api/docs/pricing)。

## 検証

通常APIでの提案・審査・確定・二重適用の防止、廃止項目を含む旧設定の読取、旧要求の再利用と未確定保持を結合試験で確認する。OpenAIではキャッシュの各内訳と費用明細、旧料金版の保持、長文料金の境界と単価の凍結、実入力による予約を確認する。モデル比較はこの経路を用いて実施する。
