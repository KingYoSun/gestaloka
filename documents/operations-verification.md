# 運用基盤の受入検証

#64〜#74で合意した範囲を、以下のケースで判定する。運用機能の追加や、未合意の制限を検証の終了条件へ加えない。実装とテストを最終の根拠とする。

## 外部サービスの実連携

Google/Xは#65で本人が新規・再ログイン、ログアウト、アカウント連携、Ory再起動と別ブラウザーでの同じユーザーへの復帰を確認した。2026-10-21の本人の選択に従い、この結果を空環境の起動・復元検証と組み合わせて判定する。新しいcallback設定と本人の再ログインは重ねない。

#67では実モデルによる2人の参加生成（34.3秒・31.5秒）と背景情報の準備（23.6秒）を確認した。別々の役割・所属・初期知識を持ち、相手の名前・役割を無条件には共有しない。今回の追加検証は制御したモデル応答を使い、有料推論callを増やさない。fixtureの認証・応答を外部サービスとの実連携として扱わない。

## ケースと確認箇所

| 対象                     | 期待結果・判定方法                                                                                                                                                                                                               | テスト                                                                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 初代・追加管理者         | 同時登録でも初代は1人。追加管理者にも任命権があり、一般ユーザーを拒否。最後の有効な管理者を保護し、CLI復旧を監査                                                                                                                 | [operations](../tests/integration/operations.test.ts)、[登録画面](../tests/e2e/registration.spec.ts)                                                                                                                             |
| 招待・BAN・失効          | 招待制、期限・回数・同時利用・失効を確認。無効な招待を画面で拒否し、有効な招待で本人が一般ユーザーとして登録。BAN・降格をAPI・SSE・MCPと画面へ反映                                                                               | [operations](../tests/integration/operations.test.ts)、[world-api](../tests/integration/world-api.test.ts)、[MCP](../tests/integration/mcp.test.ts)、[管理画面](../tests/e2e/admin.spec.ts)                                      |
| 世界構築・複数人参加     | 構築・日単位の進行・完了・公開から、2人の参加時生成へ接続。操作対象とシーン・知識を分離し、共有済みの変更を後続から参照。他プレイヤーの新たな行動を代行しない                                                                    | [participants](../tests/integration/participants.test.ts)、[gameplay](../tests/e2e/gameplay.spec.ts)                                                                                                                             |
| 画面・主体の分離         | 一般ユーザーの管理URL・APIを拒否。主体・役割変更で取得・購読・キャッシュを破棄。再読み込み・IME・狭い画面・テーマ・長い履歴を確認                                                                                                | [web](../tests/unit/web.test.tsx)、[admin](../tests/unit/admin.test.tsx)、[gameplay](../tests/e2e/gameplay.spec.ts)、[管理画面](../tests/e2e/admin.spec.ts)                                                                      |
| 全運用操作の接続         | 契約の全操作が管理画面または本人の画面とMCPの一覧に一致。共通の権限・scope・対象・監査・要求IDを適用。外部MCPクライアントで世界の生成・完了・読取・直接編集・受付照会・費用・ジョブを一貫確認                                    | [admin](../tests/unit/admin.test.tsx)、[MCP](../tests/integration/mcp.test.ts)、[実Hydra](../tests/auth/mcp.test.ts)                                                                                                             |
| モデル・単価・上限・費用 | 版保持、キー差替え、親子・dshの通算、世界予算と共有枠を確認。既知の使用量と単価で計算額・内訳・時系列・明細を照合し、未知の使用量を0へ変換しない                                                                                 | [model-settings](../tests/integration/model-settings.test.ts)、[model-limits](../tests/integration/model-limits.test.ts)、[world-budget](../tests/integration/world-budget.test.ts)、[costs](../tests/integration/costs.test.ts) |
| 中断・保留・再開         | 通信失敗、ワーカー中断、応答喪失、費用枠、停止・BAN・権限失効を制御。送信済み応答と計算額を保存し、次の推論・確定を止める。再開時の再抽選・二重確定・二重計上を防止                                                              | [runtime-control](../tests/integration/runtime-control.test.ts)、[harness](../tests/integration/harness.test.ts)、[MCP](../tests/integration/mcp.test.ts)、[受付復帰](../tests/unit/admin.test.tsx)                              |
| 監視・通知               | 異常・回復、同じ通知IDの再送、通知先変更、DB断と復旧後の保存、保持・ページ取得を確認。配送はfixtureを使用し、秘密値と世界内の知識を含めない                                                                                      | [monitor](../tests/integration/monitor.test.ts)                                                                                                                                                                                  |
| 既存データの移行         | ログインだけでは移行せず、本人が対象を確認して匿名Cookieの世界・操作対象・履歴を引き継ぐ。第三者の移行を拒否                                                                                                                     | [world-api](../tests/integration/world-api.test.ts)、[gameplay](../tests/e2e/gameplay.spec.ts)                                                                                                                                   |
| 公開配置・実復元         | HTTPSのアプリ・Ory・MCP、非公開のDB・管理API、環境ごとの鍵を確認。実HydraトークンとMCP経由で暗号化S3互換バックアップを取得し、空の別環境へ復元。Identity・権限・人物・世界・費用・保存済み処理・dsh文脈とreceiptによる再開を照合 | [配置設定](../tests/production/config.test.mjs)、[実復元](../tests/production/verify.mjs)、[HTTPS・MCP](../tests/production/mcp.mjs)                                                                                             |

バックアップ画面の受付・進捗表示は制御サービスのfixtureを使う。暗号化・送信・復元の実処理はDocker内のS3互換ストレージと別の復元先を使う。実際のサーバー契約・DNS公開・外部保管先への送信は、合意どおり運用設定後に行う。

## 再現と運用手順

`pnpm check`、`pnpm test:integration`、`pnpm test:auth`、`pnpm test:e2e`、`pnpm test:deployment`、`pnpm test:recovery`を実行する。CIはPRの現在のコミットで全項目を確認し、成功後にマージする。E2Eと結合試験の運用設定は専用DBスキーマへ隔離し、実際の世界や設定を変更しない。

外部連携・起動・管理操作は[Oryと運用設定](operations-auth.md)、MCPクライアントの登録・認可は[管理MCP](mcp.md)、公開・停止・復元は[公開配置と復旧](deployment.md)を参照する。実装時に確定した停止境界、予算・call上限、設定版の適用と直接編集の手続きを維持する。

既存環境ではAPI・ワーカーを更新し、4プロバイダーの暗号化キーを復号できること、費用1,507件の明細・集計と未確定予約額、実行待ち0件を確認した。既存の匿名世界は自動で引き継がない。
