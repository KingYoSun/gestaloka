# 自前Oryの開発環境

## 起動

既存の`.env`とDBを用意してから、リポジトリのルートで実行する。

```powershell
pnpm auth:init
pnpm auth:up
```

APIは別のターミナルで起動する。

```powershell
pnpm build:server
pnpm --filter @gestaloka/api start
```

ログイン後の戻り先となるユーザー画面も、別のターミナルで起動する。

```powershell
pnpm --filter @gestaloka/web dev
```

`auth:init`は`.env.ory`を新規作成し、`.ory/`にKratosとHydraの設定を生成する。既存の`.env.ory`は上書きせず、DBのパスワードと暗号鍵を保持する。設定値を変更した後は`pnpm auth:up`で設定を再生成し、KratosとHydraを再作成して読み込み直す。APIの設定変更後はAPIを再起動する。

`.env.ory`と`.ory/`には秘密情報が含まれるためGitへ登録しない。生成設定や`docker compose config`の全文をIssueやログへ貼り付けない。これらのファイルと`identity-data`ボリュームを失うと、保存済みIdentityやセッションの復旧に影響する。

Linuxでは`auth:init`を実行したユーザーのUID/GIDを`.env.ory`へ記録し、KratosとHydraも同じUID/GIDで起動する。生成設定の権限は所有者だけが読める`0600`に保つ。Windowsの既定値は`1000:1000`とする。

## 接続先

| 接続先                       | 開発環境のURL                        |
| ---------------------------- | ------------------------------------ |
| ログイン                     | `http://127.0.0.1:3000/auth/login`   |
| Oryセッションの確認          | `http://127.0.0.1:3000/auth/session` |
| ログアウト                   | `http://127.0.0.1:3000/auth/logout`  |
| 再認証してログイン方法を追加 | `http://127.0.0.1:3000/auth/link`    |
| Kratos Public                | `http://127.0.0.1:24433`             |
| Kratos Admin                 | `http://127.0.0.1:24434`             |
| Hydra Public / issuer        | `http://127.0.0.1:24444`             |
| Hydra Admin                  | `http://127.0.0.1:24445`             |

管理APIはループバックだけへバインドし、Ory用PostgreSQLのポートはホストへ公開しない。開発用ComposeはHTTP向けの`--dev`を使う。公開環境のHTTPS、サブドメイン間のCookie、プロキシ、秘密情報の配布・保管、復旧手順は#71で構成する。

## GoogleとXの設定

`.env.ory`に次の値を設定する。値をチャットへ送る必要はない。

| サービス | 設定値                                             | リダイレクト / Callback URI                                         |
| -------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| Google   | `ORY_GOOGLE_CLIENT_ID`, `ORY_GOOGLE_CLIENT_SECRET` | `http://127.0.0.1:24433/self-service/methods/oidc/callback/google`  |
| X        | `ORY_X_API_KEY`, `ORY_X_API_SECRET`                | `http://127.0.0.1:24433/self-service/methods/oidc/callback/twitter` |

GoogleはWebアプリケーション用のOAuthクライアントを作成し、開発中は必要なテストユーザーを登録する。XはOAuth 1.0aのAPI KeyとAPI Key Secretを使う。OAuth 2.0のClient IDではない。利用するXアプリでSign in with Xを有効にし、Callback URIを登録する。メールアドレスの取得権限は要求しない。

未設定のサービスはフォームに表示しない。`auth:up`は設定済みのサービス名だけを表示する。この表示とサービスの起動成功は、Google/Xの実ログイン成功を意味しない。

## ログイン方法の追加

`/auth/link`から既存のログイン方法で再認証し、続く画面で追加するProviderを選ぶ。追加したProviderでの本人確認後も、元のOry IdentityとアプリIDを維持する。連携の確定にはKratosの設定フロー、CSRF、直近15分以内の認証を使う。プロフィール編集やログイン方法の削除は、この画面の対象に含めない。

別のIdentityですでに使われているProviderアカウントは追加できない。メールアドレスや表示名だけで既存アカウントを統合する処理は行わない。

## 自動検証と本人確認

```powershell
pnpm test:integration
pnpm test:auth
```

`test:auth`はこの開発環境のKratos・Hydra・Ory用DBを再起動する。既存のアプリDBや世界データは再起動・編集しない。テストが作成したIdentityとOAuthクライアントは終了時に削除する。実サービスの疎通・永続化・Hydra連携を確認する試験であり、Google/Xによるログインの代わりにはならない。

各Providerで新規ログイン、再ログイン、別ブラウザーからの復帰、ログアウト後の`/auth/session`の401を確認する。再ログインと別ブラウザーでアプリのIDが変わらないことも確認する。本人のアカウント操作は利用者がブラウザーで行う。

世界APIの`/api/session`はOryで認証したアプリIDを返す。利用登録がない人とBANされた人は世界APIを利用できない。世界構築と管理記録には管理者権限が必要であり、プレイヤーの知識と操作には本人の操作対象への対応が必要となる。SSEは接続後も認証・権限を確認し、ログアウト・BAN・降格を反映する。

既存の匿名Cookieだけでは通常APIへ接続できない。ログイン後に`/auth/claim`の「このブラウザーのデータを引き継ぐ」から対象を確認する。一覧はページを送って全件を確認でき、確定ボタンは表示中のページに限らず、このCookieが持つ全対象を引き継ぐ。ログインや一覧の閲覧だけでは移行しない。対象が変わった場合は再確認が必要になる。

引き継ぎは既存の主体へアプリIDを結び付ける処理である。世界・操作対象・履歴・要求IDは保持する。既存の構築データを持っていても、サービスの管理者へ昇格することはない。

## 停止

```powershell
pnpm auth:stop
```

停止後もDBボリュームと秘密情報は保持される。

## 利用登録と管理権限

認証後に`http://127.0.0.1:3000/auth/register`を開き、本人が「利用登録する」を実行する。最初に登録が成立した1人は管理者となり、その後は有効な招待トークンを持つ人だけが登録できる。管理者は共通APIから招待制を切り替えられる。

`GET /api/account`は本人の登録・役割・BAN状態を返す。運用操作は`POST /api/operations`へ`requestId`と`command`を送る。操作と権限は[ADR-011](adr/ADR-011-operations-membership.md)を参照する。APIはOryセッションと`X-Gestaloka-Request: 1`を確認し、処理ごとに現在の権限を判定する。

`.env.ory`の`OPERATIONS_TOKEN_SECRET`は招待トークンを再送時に再生成するための署名鍵である。`pnpm auth:init`で生成し、再実行では変更しない。DBと一緒に保持する。

管理者を失った場合はサーバー上で実行する。対象は本人のログインで確認したアプリIDを指定する。

```powershell
pnpm ops:recover-admin <app-user-id> "復旧理由"
```

末尾に要求IDを指定すると同じ復旧を再送できる。復旧は招待を消費せず、管理者への任命とBAN解除を監査に残す。ワーカー、MCP、別の管理画面への接続は後続の実装で行う。
