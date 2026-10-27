# 保存資料の取得

HTTPは`POST /api/operations`へ`{requestId,command}`を送り、MCPは同じoperation名の`.`を`_`へ置き換えたツールを使う。管理者権限、operationのscope、対象世界の許可が必要。

1. `inspection.select`の`selection`へworldId、userId（旧匿名記録はnull）、actorId、endSceneId、nを指定する。指標はpresentation-v1、初期重みはunit-v1。返るmanifest IDと対象を固定する。
2. `inspection.read`へworldId、manifestIdを指定する。返るnextをafterへ渡し、nextがnullになるまで続ける。requestIdは新しい取得ごとに発行し、同じ要求の再送だけ再利用する。全ページが揃うまでは部分取得。
3. itemsのpriorは窓前の提示、presentationは本人への提示、inputは明示入力、administratorは検品のための内部根拠。administratorを新情報へ数えない。sceneとcallは状態、生成設定、費用・時間の資料。IDを報告の参照に使う。
4. 自動実行は`inspection.evaluate`へworldId、manifestId、configuration（configurationVersion、target、budgetUsd）を指定する。返る実行IDを`inspection.evaluation`で読む。意図した再評価は新しいrequestIdを使う。

manifestはDBとバックアップの保持中は不変。同じ選択でも記録が増えれば別manifestとなる。削除や復元で失われたIDは404であり、現在のグラフから補完しない。対応情報のない旧記録、費用・時間の欠測、途中・保留は報告に残す。providedAtがnullなら提供時刻も未記録。

開発入口は`pnpm story:inspect --world <worldId> --manifest <manifestId> --output <directory>`。意味評価を含める場合は`--semantic --configuration <version> --target resolution --budget <USD>`を加える。HTTP接続には`GESTALOKA_API_URL`とログイン済みの`GESTALOKA_COOKIE`、または許可scopeを持つ`GESTALOKA_MCP_TOKEN`をローカル環境へ設定する。秘密値を報告へ出さない。
