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
- BAN時は実行中のAPI応答を回収して保存し、新たな推論と世界への確定を止める。実行済み分の計算額を記録し、BAN解除後に再開できるようにする。確定済みの世界と履歴は保持する。

## 実装と検証の範囲

最初の変更はOryの起動・マイグレーション・永続化、ブラウザーのログイン入口、セッション検証、Identityとの対応、Hydraのログイン・同意・ログアウトを対象とする。既存APIの認可切替と匿名Cookieの移行は#66・#67へ接続する。この段階では既存の世界への利用権限を変更しない。

実Kratosのブラウザーフローと未認証拒否、実HydraのPKCEによる認可コード発行、DB・Ory再起動後のIdentity・OAuthクライアント・署名鍵の保持を検証する。認証済みセッションの自動試験にはテスト応答を使うため、Google/Xの本人ログイン、再ログイン、別ブラウザー、ログアウトは開発者アプリで別途確認する。実連携が未確認の間は#65を完了としない。

## 参照

- [Kratos v26.2.0](https://github.com/ory/kratos/releases/tag/v26.2.0)
- [Hydra v26.2.0](https://github.com/ory/hydra/releases/tag/v26.2.0)
- [KratosのXプロバイダー実装](https://github.com/ory/kratos/blob/v26.2.0/selfservice/strategy/oidc/provider_x.go)
- [Kratosのブラウザーフロー](https://www.ory.com/docs/kratos/self-service)
- [Googleの設定](https://www.ory.com/docs/kratos/social-signin/google)
- [Xの設定](https://www.ory.com/docs/kratos/social-signin/x-twitter)
