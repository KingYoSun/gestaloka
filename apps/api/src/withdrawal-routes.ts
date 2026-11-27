import { Signer } from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import { IdentityError, type OryIdentity } from "@gestaloka/server/identity";
import type { WorldAccess } from "@gestaloka/server/access";
import type { Operations } from "@gestaloka/server/operations";
import { legalContact } from "@gestaloka/server/legal";
import { z } from "zod";
import { authPage, escapeHtml as html } from "./auth-page.js";

function deadlines(receipt: Record<string, unknown>) {
  const start = Date.parse(String(receipt.confirmed_at));
  const limit = (days: number) => {
    const date = new Date(start + days * 86400000);
    return Number.isFinite(date.getTime())
      ? date.toLocaleString("ja-JP", {
          timeZone: "Asia/Tokyo",
          hour12: false,
        }) + "（日本時間）"
      : `確定から${days}日以内`;
  };
  return `<dl><dt>公開停止期限</dt><dd>${limit(1)}</dd><dt>本番原本の削除期限</dt><dd>${limit(30)}</dd><dt>バックアップを含む消去期限</dt><dd>${limit(30 + Number(receipt.retention_days))}</dd></dl>`;
}

export function withdrawalRoutes(
  app: FastifyInstance,
  identity: OryIdentity,
  operations: Operations,
  access?: WorldAccess,
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
          : status.structured_at
            ? "本人に紐付く記録の削除が済みました。運営が引用や紹介資料を個別に確認しています。"
            : "退会を受け付けました。削除作業中です。";
      return authPage(
        reply,
        "退会の受付状況",
        `<p>${phase}</p>${deadlines(status)}<p>問い合わせ窓口：${html(legalContact)}</p>`,
      );
    },
  );
  app.get<{ Querystring: { before?: string; actorBefore?: string } }>(
    "/auth/withdraw",
    { schema: { hide: true } },
    async (request, reply) => {
      let owner;
      try {
        owner = await identity.session(request.headers.cookie);
      } catch (error) {
        if (error instanceof IdentityError && error.status === 401)
          return reply.redirect(
            "/auth/login?return_to=" +
              encodeURIComponent(
                `${request.protocol}://${request.host}/auth/withdraw`,
              ),
          );
        throw error;
      }
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
      const actors = (
        await operations.pool.query<{
          actor_id: string;
          id: string;
          world_id: string;
          public_title: string;
        }>(
          `
        SELECT DISTINCT a.actor_id,c.id,c.world_id,c.public_title FROM world_access a JOIN world_subject s ON s.id=a.subject_id
        JOIN world_construction c ON c.id=a.construction_id WHERE s.user_id=$1 AND a.role='player' AND a.actor_id IS NOT NULL
        AND ($2::uuid IS NULL OR a.actor_id<$2) ORDER BY a.actor_id DESC LIMIT 51`,
          [owner.userId, z.uuid().optional().parse(request.query.actorBefore)],
        )
      ).rows;
      const people = await Promise.all(
        actors.slice(0, 50).map(async (a) => {
          const node = await access?.construction.agent.store
            .context(a.world_id)
            .node(a.actor_id);
          return `<li>${html(node?.text ?? a.actor_id)}（<a href="/worlds/${a.id}">${html(a.public_title)}</a>）</li>`;
        }),
      );
      const works = stories
        .slice(0, 50)
        .map(
          (s) =>
            `<li><label><input form="withdraw" type="checkbox" name="keep_${s.id}"> ${html(s.title)}（${html(s.world_title)}）</label> <code>${s.id}</code></li>`,
        )
        .join("");
      return authPage(
        reply,
        "退会の申請",
        "<p>このアカウントで参加するすべての世界が対象です。確定するとログイン・端末の操作・待機を終了し、プロフィールとアイコンを取り下げます。共有した会話や取引、建物は残り、人物の表示は「退会済み」に変わります。</p>" +
          (people.length
            ? "<h2>退会の対象になる人物</h2><ul>" + people.join("") + "</ul>"
            : "") +
          (actors.length > 50
            ? `<a target="_blank" rel="noopener" href="?actorBefore=${actors[49]!.actor_id}">次の人物を見る</a>`
            : "") +
          "<p>STORIESの本文と画像は原則削除します。公開を続けたい作品にチェックを入れてください。別のページにある作品は、IDでも指定できます。</p>" +
          (works
            ? "<h2>公開中の自分の作品</h2><ul>" + works + "</ul>"
            : "<p>このページには公開中の作品はありません。</p>") +
          (stories.length > 50
            ? `<a target="_blank" rel="noopener" href="?before=${stories[49]!.id}">次の作品とIDを見る</a>`
            : "") +
          `<form id="withdraw" method="post"><input type="hidden" name="csrf" value="${html(signer.sign("withdraw:" + owner.sessionId))}"><label>ほかに公開を続ける作品のID（1行に1件）<textarea name="keep"></textarea></label><label><input type="checkbox" name="confirm" value="yes" required>全世界を対象に退会し、選んだ作品以外の削除を申し込みます</label><button>退会を確定する</button></form><p>ログインできない場合や、会話中の個人情報・紹介資料については運営窓口（${html(legalContact)}）へご連絡ください。</p>`,
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
      const ids = z.array(z.uuid()).safeParse([
        ...new Set([
          ...Object.keys(request.body)
            .filter((k) => k.startsWith("keep_"))
            .map((k) => k.slice(5)),
          ...(keep ?? "").split(/\s+/).filter(Boolean),
        ]),
      ]);
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
        `<p>受付番号 <code>${html(receipt.receipt)}</code></p>${deadlines(receipt)}<p><a href="/auth/withdraw/status/${html(receipt.receipt)}">退会の受付状況を確認する</a>。このリンクを手元に保存してください。</p><p>個別のご相談は、受付番号を添えて運営窓口（${html(legalContact)}）へご連絡ください。</p>`,
      );
    },
  );
}
