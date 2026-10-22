# ADR-010: 運用基盤の認証と権限

## 決定

認証は自前運用のKratosとHydraを使う。最初の対応版は両方ともv26.2.0とし、コンテナーのdigestまで固定する。KratosはGoogleとXのログイン、Identity、セッションを管理する。Hydraは外部クライアント向けのOAuth認可サーバーを担う。

アプリのユーザーIDはOry Identity IDと一対一で対応付ける。メールアドレスや名前による自動統合は行わず、Identityのtraitsから管理権限を受け取らない。Identityの対応付けと、招待条件の確認を含むアプリの利用登録は別の処理とする。初代管理者は利用登録の成立時に一度だけ決定する。

GoogleはOIDC、XはKratosの`x`プロバイダーによるOAuth 1.0aを使う。Xの設定IDは`twitter`とする。メールアドレスをIdentity成立の条件にせず、プロフィールからは表示名だけを保存する。Google/Xの連携は、ログイン済みの本人が再認証して行う。

セッションの確認はKratosの`/sessions/whoami`で行う。有効なセッション、Identityの状態、有効期限を確認し、認証サービスの障害を認証成功として扱わない。ブラウザーにはネイティブ向けフローを使わず、CSRF Cookieを伴うブラウザーフローを使う。

Hydraのログインには、Kratosで検証した利用者のアプリIDとセッションIDを渡す。同意時にも現在の利用者との一致を確認し、フォームのCSRFを検証する。認証の同意と、MCPの操作権限の確認は別に行う。

## ユーザーが選択した運用方針

- 管理画面はユーザー画面と別のアプリ・サブドメインへ分離する。
- 全管理者が追加の管理者を任命できる。最後の有効な管理者の降格・BANは拒否し、緊急復旧はサーバー上の専用CLIで行う。
- 初代管理者は招待なしで一度だけ利用登録でき、その登録後は招待制を有効にする。
- 匿名Cookieの既存データは、ログイン後に本人が対象を確認して引き継ぐ。ログインだけで所有者を変更しない。
- BAN時は実行中のAPI応答を回収して保存し、新たな推論と世界への確定を止める。実行済み分の計算額を記録し、BAN解除後に再開できるようにする。確定済みの世界と履歴は保持する。

## 実装と検証の範囲

導入時はOryの起動・マイグレーション・永続化、ブラウザーのログイン入口、セッション検証、Identityとの対応、Hydraのログイン・同意・ログアウトを接続し、既存の世界への利用権限は変更しなかった。その後、利用登録と管理権限は[ADR-011](ADR-011-operations-membership.md)、世界APIの認可と匿名Cookieの引き継ぎは[ADR-012](ADR-012-authenticated-world-access.md)、画面の分離と参加は[ADR-013](ADR-013-world-participation.md)へ接続した。MCP、処理中ジョブの停止境界、公開配置と復旧も[運用検証表](../operations-verification.md)の範囲で接続済みである。

実Kratosのブラウザーフローと未認証拒否、実HydraのPKCEによる認可コード発行、DB・Ory再起動後のIdentity・OAuthクライアント・署名鍵の保持を自動試験で確認する。認証済みセッションにテスト応答を使う試験と、Google/Xの本人操作は区別する。#65での新規・再ログイン、連携、別ブラウザーからの復帰、ログアウトの完了記録は運用検証表を参照する。新しい配備先の確認手順は[公開配置と復旧](../deployment.md)に従う。

## 参照

- [Kratos v26.2.0](https://github.com/ory/kratos/releases/tag/v26.2.0)
- [Hydra v26.2.0](https://github.com/ory/hydra/releases/tag/v26.2.0)
- [KratosのXプロバイダー実装](https://github.com/ory/kratos/blob/v26.2.0/selfservice/strategy/oidc/provider_x.go)
- [Kratosのブラウザーフロー](https://www.ory.com/docs/kratos/self-service)
- [Googleの設定](https://www.ory.com/docs/kratos/social-signin/google)
- [Xの設定](https://www.ory.com/docs/kratos/social-signin/x-twitter)
