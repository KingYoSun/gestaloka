import { Signer } from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import type { OryIdentity } from "@gestaloka/server/identity";
import type { Operations } from "@gestaloka/server/operations";
import { legalContact } from "@gestaloka/server/legal";
import { z } from "zod";
import { authPage, escapeHtml as html } from "./auth-page.js";

export function withdrawalRoutes(
  app: FastifyInstance,
  identity: OryIdentity,
  operations: Operations,
) {
  const signer = new Signer(operations.tokenSecret);
  app.get<{ Params: { receipt: string } }>(
    "/auth/withdraw/status/:receipt",
    { schema: { hide: true } },
    async (request, reply) => {
      const id = z.uuid().safeParse(request.params.receipt);
      const status = id.success
        ? await operations.backups.call("withdrawal-status", {
            receipt: id.data,
          })
        : {};
      if (!status.confirmed_at)
        return authPage(
          reply.code(404),
          "退会の受付状況",
          "<p>受付番号を確認してください。</p>",
        );
      const phase = status.finished_at
        ? "バックアップの消去を確認しました。"
        : status.erased_at
          ? "本番の原本を削除しました。バックアップの消去を確認中です。"
          : "退会を受け付けました。削除作業中です。";
      return authPage(
        reply,
        "退会の受付状況",
        `<p>${phase}</p><p>問い合わせ窓口：${html(legalContact)}</p>`,
      );
    },
  );
  app.get<{ Querystring: { before?: string } }>(
    "/auth/withdraw",
    { schema: { hide: true } },
    async (request, reply) => {
      if (!request.headers.cookie)
        return reply.redirect(
          "/auth/login?return_to=" +
            encodeURIComponent(
              `${request.protocol}://${request.host}/auth/withdraw`,
            ),
        );
      const owner = await identity.session(request.headers.cookie);
      const cursor = z.uuid().optional().parse(request.query.before);
      const stories = (
        await operations.pool.query<{
          id: string;
          title: string;
          world_title: string;
        }>(
          `
      SELECT id,title,world_title FROM player_story WHERE author_id=$1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR id<$2)
      ORDER BY id DESC LIMIT 51`,
          [owner.userId, cursor],
        )
      ).rows;
      const works = stories
        .slice(0, 50)
        .map(
          (s) =>
            `<li>${html(s.world_title)} ／ <a href="/stories/${s.id}">${html(s.title)}</a> <code>${s.id}</code></li>`,
        )
        .join("");
      return authPage(
        reply,
        "退会の申請",
        "<p>このアカウントで参加するすべての世界が対象です。確定するとログイン・端末の操作・待機を終了し、プロフィールとアイコンを取り下げます。共有した会話や取引、建物は残り、人物の表示は「退会済み」に変わります。</p>" +
          "<p>STORIESの本文と画像は原則削除します。公開を続けたい作品だけ、下の欄に作品IDを入力してください。</p>" +
          (works
            ? "<h2>公開中の自分の作品</h2><ul>" + works + "</ul>"
            : "<p>このページには公開中の作品はありません。</p>") +
          (stories.length > 50
            ? `<a href="?before=${stories[49]!.id}">次の作品を見る</a>`
            : "") +
          `<form method="post"><input type="hidden" name="csrf" value="${html(signer.sign("withdraw:" + owner.sessionId))}"><label>公開を続ける作品のID（1行に1件）<textarea name="keep"></textarea></label><label><input type="checkbox" name="confirm" value="yes" required>全世界を対象に退会し、選んだ作品以外の削除を申し込みます</label><button>退会を確定する</button></form><p>ログインできない場合や、会話中の個人情報・紹介資料については運営窓口（${html(legalContact)}）へご連絡ください。</p>`,
      );
    },
  );
  app.post<{ Body: { csrf?: string; confirm?: string; keep?: string } }>(
    "/auth/withdraw",
    { schema: { hide: true } },
    async (request, reply) => {
      const owner = await identity.session(request.headers.cookie);
      const { csrf, confirm, keep } = request.body;
      if (
        confirm !== "yes" ||
        !csrf ||
        signer.unsign(csrf).value !== "withdraw:" + owner.sessionId
      )
        return authPage(
          reply.code(403),
          "本人確認が必要です",
          '<a href="/auth/withdraw">退会の申請画面に戻る</a>',
        );
      const ids = z
        .array(z.uuid())
        .safeParse([...new Set((keep ?? "").split(/\s+/).filter(Boolean))]);
      if (
        !ids.success ||
        (
          await operations.pool.query(
            "SELECT id FROM player_story WHERE author_id=$1 AND deleted_at IS NULL AND id=ANY($2::uuid[])",
            [owner.userId, ids.data],
          )
        ).rows.length !== ids.data.length
      )
        return authPage(
          reply.code(400),
          "作品を確認してください",
          '<p>公開を続ける作品には、自分が公開している作品のIDを指定してください。</p><a href="/auth/withdraw">申請画面に戻る</a>',
        );
      const receipt = await operations.backups.call("withdraw", {
        user: owner.userId,
        identity: owner.identityId,
        keep: ids.data,
      });
      return authPage(
        reply,
        "退会を受け付けました",
        `<p>受付番号 <code>${html(receipt.receipt)}</code></p><p><a href="/auth/withdraw/status/${html(receipt.receipt)}">退会の受付状況を確認する</a>。このリンクを手元に保存してください。</p><p>個別のご相談は、受付番号を添えて運営窓口（${html(legalContact)}）へご連絡ください。</p>`,
      );
    },
  );
}
