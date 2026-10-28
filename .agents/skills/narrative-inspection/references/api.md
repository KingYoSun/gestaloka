# 保存資料の取得

HTTPは`POST /api/operations`へ`{requestId,command}`を送り、MCPは同じoperation名の`.`を`_`へ置き換えたツールを使う。管理者権限、operationのscope、対象世界の許可が必要。

1. `inspection.select`の`selection`へworldId、userId（旧匿名記録はnull）、actorId、endSceneId、nを指定する。既定の指標は正本から保存した構造参照を数えるpresentation-v3、初期重みはunit-v1。初期提示も既知集合に含める。旧指標presentation-v1/v2と旧manifestの保存値は維持し、旧形式の対応をv3の正本参照へ推測で変換しない。異なる指標版を直接比較しない。返るmanifest IDと対象を固定する。
2. `inspection.read`へworldId、manifestIdを指定する。返るnextをafterへ渡し、nextがnullになるまで続ける。requestIdは新しい取得ごとに発行し、同じ要求の再送だけ再利用する。全ページが揃うまでは部分取得。
3. itemsのinitialはプレイ開始前の初期提示、priorは窓前のシーンでの提示、presentationは本人への提示、inputは明示入力、administratorは検品のための内部根拠。initialとpriorは既知情報、administratorは検品資料であり、いずれも選択窓の新情報へ数えない。manifest.initialRecordingがmissingなら初期提示は未記録。sceneとcallは状態、生成設定、費用・時間の資料。IDを報告の参照に使う。
4. 自動実行は`inspection.evaluate`へworldId、manifestId、configuration（configurationVersion、target、budgetUsd）を指定する。返る実行IDを`inspection.evaluation`で読む。意図した再評価は新しいrequestIdを使う。

manifestはDBとバックアップの保持中は不変。同じ選択でも記録が増えれば別manifestとなる。削除や復元で失われたIDは404であり、現在のグラフから補完しない。対応情報のない旧記録、費用・時間の欠測、途中・保留は報告に残す。providedAtがnullなら提供時刻も未記録。

開発入口は`pnpm story:inspect --world <worldId> --manifest <manifestId> --output <directory>`。意味評価を含める場合は`--semantic --configuration <version> --target resolution --budget <USD>`を加える。HTTP接続には`GESTALOKA_API_URL`とログイン済みの`GESTALOKA_COOKIE`、または許可scopeを持つ`GESTALOKA_MCP_TOKEN`をローカル環境へ設定する。秘密値を報告へ出さない。
