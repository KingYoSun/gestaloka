import { createHash } from "node:crypto";
import type pg from "pg";
import { AccessError } from "./access-error.js";

export const legalEdition = "2026-11-27";
export const legalOperator = process.env.LEGAL_OPERATOR_NAME?.trim() ?? "";
export const legalContact = process.env.LEGAL_CONTACT?.trim() ?? "";
export const legalContactUrl = /^https?:\/\//i.test(legalContact)
  ? legalContact
  : /^[^\s@]+@[^\s@]+$/.test(legalContact)
    ? "mailto:" + legalContact
    : null;
export const legalConfigured = Boolean(legalOperator && legalContact);
const contactLine = legalContact ? "\n問い合わせ先 " + legalContact : "";
const provider = legalOperator
  ? `${legalOperator}（以下「運営者」という。）`
  : "本サービスの運営者";
export const terms = `第1条（適用）
本規約は、${provider}が提供するテキストMMORPG「GESTALOKA」（以下「本サービス」という。）の利用条件を定める。利用者は、本規約及びプライバシーポリシーを確認し、その双方に同意して利用登録を行う。

第2条（登録及びアカウント管理）
利用者は、自己のアカウント、パスワード、招待コード及び端末の認可情報を適切に管理するものとする。未成年者は、法定代理人の同意を得て登録するものとする。
利用者は、自ら選んだAI又はボットに人物の操作を許可できる。その許可の範囲で行われた発言、行動及び投稿は、当該利用者による本サービスの利用として取り扱う。利用者はブラウザーで端末の許可を解除できる。規約等への同意は、アカウントの利用者本人が行う。

第3条（共有世界及び生成内容）
本サービスでは、利用者の入力、他の参加者の行動及びAIによる生成又は判定が、共有世界の状態と履歴に反映される。人物が知り得る情報、同席者への提示及び観戦者が閲覧できる範囲は、世界の状態及び公開設定による。運営者は、特定の生成内容、判定結果又は物語の展開を保証しない。

第4条（投稿等の権利）
利用者が入力した文章、STORIESの作品・各話・添付画像その他の投稿物について、利用者又は第三者が有する著作権は各権利者に留保される。利用者は、自らが有する権利又は適法に得た許諾の範囲で投稿し、第三者の著作権、肖像権、プライバシーその他の権利を侵害してはならない。
利用者は、運営者に対し、本サービスの提供に必要な範囲で、投稿物を保存、複製、表示、公衆送信し、表示用に画像の形式及び寸法を変更することを無償かつ非独占的に許諾する。

第5条（プレイログ及びSTORIESの紹介利用）
利用者は、運営者が本サービスを紹介する目的で、プレイログに含まれる当該利用者の発言、行動、コメント及びその結果、並びに当該利用者がSTORIESに投稿した作品名、著者表示名、本文及び添付画像を利用することを許諾する。この許諾は無償かつ非独占的とし、公式サイト、SNS、紹介記事、動画、配信及び展示資料における複製、掲載、上映、公衆送信及び頒布を含む。これらの媒体はゲームに参加していない者も閲覧できる。
運営者は、紹介に必要な範囲で抜粋、要約、字幕の付加、画像の縮小又はトリミングを行うことができる。運営者は、発言又は作品の趣旨を損なわず、個人を特定する現実の情報、認証情報及び運営への非公開の相談を紹介対象から除く。利用者は、紹介に伴う権利上の問題を運営者に申し出ることができる。

第6条（禁止事項及び利用の制限）
利用者は、なりすまし、不正アクセス、他人の認可情報の使用、他人への嫌がらせ、第三者の個人情報の無断投稿、違法な内容の投稿その他本サービスの運営を妨害する行為をしてはならない。運営者は、違反の内容及び影響に応じ、投稿の非公開化又は利用の制限若しくは停止を行うことができる。

第7条（提供の中断及び責任）
運営者は、保守、障害対応その他運営上の必要があるときは、本サービスの提供を中断できる。運営者は、事前の周知が可能なときは、その旨を利用者に知らせる。運営者の責めに帰すべき事由によって利用者に損害が生じた場合の責任は、民法、消費者契約法その他の適用法令に従う。

第8条（改定及び準拠法）
運営者は、本規約又はプライバシーポリシーを改定するときは、改定内容及び適用開始日を本サービス上で周知し、改定版を掲示する。改定後のゲームプレイには、利用者本人による最新版への同意を要する。同意を保留している間も、接続及び通知の閲覧は利用できる。
本規約の準拠法は日本法とする。本サービスに関する紛争の管轄は、適用される法令の定めによる。${contactLine}`;

export const privacy = `第1条（適用範囲）
GESTALOKAの運営者${legalOperator ? `（${legalOperator}）` : ""}は、本サービスのWeb画面、プレイヤーCLI及び利用者が許可した端末を通じて取り扱う利用者情報について、次のとおり定める。

第2条（取得する情報）
運営者は、ログインID、パスワードの照合に用いる情報、外部ログインを選択した場合の連携先の識別子及び提供された表示名、アカウント・端末・人物の識別子、招待の利用状況、同意した規約等の版及び同意日時を取り扱う。
運営者は、人物設定及び画像、発言、行動、コメント、生成結果、世界及び手番の履歴、通知、観戦・フレンド設定、STORIESの文章・著者表示名・画像・ブックマーク、利用者が運営に送った報告を取り扱う。通信及び障害対応に伴い、IPアドレス、アクセス日時、要求の識別子、操作及びエラーの記録を取り扱うことがある。

第3条（利用目的）
運営者は、本人確認、招待及び端末の認可、同意の確認、共有世界の運営及び保存、物語の生成、投稿・観戦・通知の提供、問い合わせ対応、不正利用の防止、障害調査、生成品質の検証及び利用量・生成費用の管理のため、前条の情報を利用する。
運営者は、本サービスを紹介するため、利用規約第5条に定める対象及び媒体に限り、プレイログ及びSTORIESを利用する。

第4条（他の利用者に表示する情報）
同席者には手番の発言、行動結果及びコメント等を、観戦者には観戦の許可又は公開設定に応じた記録を表示する。STORIESの作品及び添付画像は、当該世界に人物を持つ利用者が閲覧できる。ゲーム外での紹介には前条第2項を適用する。利用者は、入力又は投稿に実生活の連絡先や第三者の秘密を含めないものとする。

第5条（認証、生成AI及び外部への提供）
外部ログインを選択した場合は、設定されたGoogle又はXと認証に必要な情報を授受する。利用者が外部のAI又はボットに操作を許可した場合は、当該端末に、その人物の操作に必要な情報及び通知を送信する。
運営者は、生成又は検品を行うとき、入力、人物の設定、関連する世界状態及び履歴のうち、処理に必要な部分を運営環境で設定したAI事業者に送信する。接続先にはOpenRouter及びそのモデル提供先、Anthropic、OpenAI、Google又はDeepSeekが含まれ得る。
運営者は、認証、サーバー管理及び生成処理等を委託するときは、委託先を必要かつ適切に監督する。個人データを第三者に提供する場合は、法令に定める例外を除き、あらかじめ本人の同意を得る。外国にある事業者に個人データを提供する場合は、法令に従い、必要な情報提供、同意の取得又は相当の措置の継続的な確認を行う。

第6条（Cookie及び端末内の保存）
ブラウザーでは、ログイン状態の維持、フォーム送信の検証及び登録時の同意の引継ぎにCookieを使用し、表示設定や処理中の要求の識別に端末内の保存領域を使用する。CLIは、接続先、端末の認可情報、送信した要求及び結果等を利用者の端末に保存する。

第7条（保存及び安全管理）
運営者は、認証情報とゲームデータを分けて管理し、利用者の権限及び人物との関係に応じて閲覧・操作を制限する。情報は、利用目的の達成、共有世界の履歴の維持、紛争対応又は法令上の義務の履行に必要な期間保存し、その必要がなくなったときは消去等の措置を講じる。
STORIESの著者は、Web又はCLIから自分の作品を編集し、作品又は各話を公開から取り下げることができる。公開の取下げ後も、既に配布した紹介資料や保全用の複製に記録が残る場合がある。

第8条（開示等の請求及び問い合わせ）
利用者は、運営者に対し、利用目的の通知、保有個人データ又は第三者提供記録の開示、訂正、追加、削除、利用停止、消去又は第三者提供の停止を請求できる。運営者は、本人又は代理人であることを確認し、法令に従って対応し、対応の可否とその理由を通知する。
個人情報の取扱いに関する苦情、紹介資料に関する申出及び上記の請求は、運営者の問い合わせ窓口で受け付ける。運営者の氏名又は名称、住所、法人の場合の代表者氏名及び安全管理措置については、本人の求めに応じて法令に従い遅滞なく回答する。${contactLine}`;

// The two documents are accepted together. Editing either text changes the version.
export const legalVersion =
  legalEdition +
  "-" +
  createHash("sha256")
    .update(JSON.stringify([terms, privacy]))
    .digest("hex")
    .slice(0, 16);

type Database = Pick<pg.Pool, "query">;
export async function hasLegalConsent(db: Database, userId: string) {
  return (
    legalConfigured &&
    !!(
      await db.query(
        "SELECT 1 FROM app_legal_consent WHERE user_id=$1 AND version=$2",
        [userId, legalVersion],
      )
    ).rowCount
  );
}
export async function requireLegalConsent(db: Database, userId: string) {
  if (!(await hasLegalConsent(db, userId)))
    throw new AccessError(
      403,
      "LEGAL_CONSENT_REQUIRED",
      "ゲームをプレイするには、アカウントの持ち主が最新版の利用規約とプライバシーポリシーに同意してください。",
    );
}
function requireLegalConfiguration() {
  if (!legalConfigured)
    throw new AccessError(
      503,
      "LEGAL_NOT_CONFIGURED",
      "運営者名と問い合わせ先を設定するまで、同意の受付を休止しています。",
    );
}
export async function recordLegalConsent(db: Database, userId: string) {
  requireLegalConfiguration();
  await db.query(
    "INSERT INTO app_legal_consent(user_id,version,accepted_at) VALUES($1,$2,now()) ON CONFLICT DO NOTHING",
    [userId, legalVersion],
  );
}

export async function beginRegistrationConsent(db: Database) {
  requireLegalConfiguration();
  await db.query(
    "DELETE FROM app_legal_registration WHERE id IN (SELECT id FROM app_legal_registration WHERE accepted_at <= now() - interval '30 minutes' ORDER BY accepted_at LIMIT 32)",
  );
  return (
    await db.query<{ id: string }>(
      "INSERT INTO app_legal_registration(version) VALUES($1) RETURNING id",
      [legalVersion],
    )
  ).rows[0]!.id;
}

// Only the identity provider can attach the returned receipt to a verified identity.
export async function registrationConsent(
  db: Database,
  receipt: string | undefined,
  flow?: string,
  claim = false,
) {
  if (
    !legalConfigured ||
    !receipt ||
    !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(receipt)
  )
    return;
  const condition =
    "WHERE id=$1 AND version=$2 AND accepted_at > now() - interval '30 minutes' AND (flow_id IS NULL OR flow_id=$3)";
  const fields = 'version, accepted_at AS "acceptedAt"';
  return (
    await db.query<{ version: string; acceptedAt: Date }>(
      claim
        ? `UPDATE app_legal_registration SET flow_id=$3 ${condition} RETURNING ${fields}`
        : `SELECT ${fields} FROM app_legal_registration ${condition}`,
      [receipt, legalVersion, flow ?? null],
    )
  ).rows[0];
}
