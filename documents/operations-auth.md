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

| 接続先                | 開発環境のURL                        |
| --------------------- | ------------------------------------ |
| ログイン              | `http://127.0.0.1:3000/auth/login`   |
| Oryセッションの確認   | `http://127.0.0.1:3000/auth/session` |
| ログアウト            | `http://127.0.0.1:3000/auth/logout`  |
| Kratos Public         | `http://127.0.0.1:24433`             |
| Kratos Admin          | `http://127.0.0.1:24434`             |
| Hydra Public / issuer | `http://127.0.0.1:24444`             |
| Hydra Admin           | `http://127.0.0.1:24445`             |

管理APIはループバックだけへバインドし、Ory用PostgreSQLのポートはホストへ公開しない。開発用ComposeはHTTP向けの`--dev`を使う。公開環境のHTTPS、サブドメイン間のCookie、プロキシ、秘密情報の配布・保管、復旧手順は#71で構成する。

## GoogleとXの設定

`.env.ory`に次の値を設定する。値をチャットへ送る必要はない。

| サービス | 設定値                                             | リダイレクト / Callback URI                                         |
| -------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| Google   | `ORY_GOOGLE_CLIENT_ID`, `ORY_GOOGLE_CLIENT_SECRET` | `http://127.0.0.1:24433/self-service/methods/oidc/callback/google`  |
| X        | `ORY_X_API_KEY`, `ORY_X_API_SECRET`                | `http://127.0.0.1:24433/self-service/methods/oidc/callback/twitter` |

GoogleはWebアプリケーション用のOAuthクライアントを作成し、開発中は必要なテストユーザーを登録する。XはOAuth 1.0aのAPI KeyとAPI Key Secretを使う。OAuth 2.0のClient IDではない。利用するXアプリでSign in with Xを有効にし、Callback URIを登録する。メールアドレスの取得権限は要求しない。

未設定のサービスはフォームに表示しない。`auth:up`は設定済みのサービス名だけを表示する。この表示とサービスの起動成功は、Google/Xの実ログイン成功を意味しない。

## 自動検証と本人確認

```powershell
pnpm test:integration
pnpm test:auth
```

`test:auth`はこの開発環境のKratos・Hydra・Ory用DBを再起動する。既存のアプリDBや世界データは再起動・編集しない。テストが作成したIdentityとOAuthクライアントは終了時に削除する。実サービスの疎通・永続化・Hydra連携を確認する試験であり、Google/Xによるログインの代わりにはならない。

各Providerで新規ログイン、再ログイン、別ブラウザーからの復帰、ログアウト後の`/auth/session`の401を確認する。再ログインと別ブラウザーでアプリのIDが変わらないことも確認する。本人のアカウント操作は利用者がブラウザーで行う。

既存画面の`/api/session`と世界の権限は、匿名Cookieの移行を接続するまで従来のままである。Oryでログインしただけでは既存世界への権限は付かない。#65の実連携確認と、#66以降の利用登録・管理権限・移行を完了してから全体を切り替える。

## 停止

```powershell
pnpm auth:stop
```

停止後もDBボリュームと秘密情報は保持される。
