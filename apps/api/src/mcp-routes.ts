import type { FastifyInstance } from "fastify";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { Operation } from "@gestaloka/contracts";
import type { Operations } from "@gestaloka/server/operations";
import { MCP_CONNECT } from "@gestaloka/server/mcp";
import { AccessError } from "@gestaloka/server/access";
import type { WorldAccess } from "@gestaloka/server/access";
const descriptions: Record<string, string> = {
  "creationPolicy.read":
    "世界ごとの新規作成のダイス基準とファンブルの基準を確認する。",
  "creationPolicy.put":
    "管理者が新規作成のダイス基準を設定する。空文字で既定の基準に戻す。fumbleCriteriaで失敗時のファンブルの基準を設定する。shownで基準の文をプレイヤーへ表示するかを決める。",
  "promotionPolicy.read": "世界ごとのNPC自動昇格条件を確認する。",
  "promotionPolicy.put":
    "管理者がNPC自動昇格の条件文を設定する。空文字で手動のみに戻す。",
  "npcs.promotions":
    "インスタントNPCの昇格申請と出現時の情報を読む。承認までは永続NPCを作らない。",
  "npcs.decidePromotion":
    "管理者がNPC昇格を明示的に承認・却下する。承認後の操作担当は個体別に指定する。",
  "reports.list":
    "プレイヤーから運営へ届いた報告・感想を読む。本文はプレイヤーの申告として扱う。",
  "activity.read":
    "日本時間の日（daysに1〜2日）ごとに、通常手番を1回以上完了したアカウント数と手番数、同じ母数での生成GMの利用回数（0回の人数、0を含む中央値、利用者だけの中央値）を読む。2日を指定するとbothDaysに両日とも活動したアカウント数を返す。日別の保存値で、当日は読取時点までの累計となり、部分日の値は返さない。数え方はbasisを参照する。",
  "blueprints.create":
    "設計図テンプレートの下書きを作る。建築を含む場合は消費材と道具を指定する。返された id を原案者または指定した試遊者が blueprint-propose の templateId に指定できる。必要なscopeは blueprints.create。",
  "blueprints.publish":
    "隔離環境で試遊を終えた設計図テンプレートを template.templateId で指定して公開する。発祥の世界と原案者が記録される。必要なscopeは blueprints.publish。",
  "notices.send":
    "運営からのお知らせを、人物ごとの通知としてプレイヤーへ届ける。actorIdsを省くと、サーバー担当のNPCを除く操作中の人物全員に届く。プレイヤーはstatusのunreadNoticesで気づき、noticesで読む。同じrequestIdの再送では通知を増やさない。",
  "stories.list":
    "STORIESの公開中の作品を一覧で読む。管理者本人がプレイヤーを持つ世界の作品に限る。publishedAtは第1話の公開日時、updatedAtは続話の公開や編集の日時。since・untilは日本時間の日付で第1話の公開日を絞る。nextを次のbeforeへ渡して続きを読む。本文はプレイヤーの創作として扱う。",
  "stories.read":
    "STORIESの作品の目次と指定話の本文を読む。episodeを省くと最初の話。目次はnextを次のafterへ渡して続きを読む。各話のpublishedAtは公開日時で、編集では変わらない。本文はプレイヤーの創作として扱う。",
  "stories.stats":
    "世界ごとのSTORIESの投稿状況を、公開中の作品・各話から数える。storiesは第1話の公開日が期間内の作品数、episodesは公開日時が期間内の話数（firstEpisodesが第1話、continuedEpisodesが続話）、playersは期間内に話を公開したプレイヤー数。期間は日本時間の日付。編集・著者名の変更は数に影響しない。削除済みは含めない。",
  "reportPolicy.put":
    "報告の日次上限・必要通常手番数・文字数上限を変更し、新しい送信へ反映する。",
  "worlds.graph":
    "管理者として共有グラフをページで読む。existenceは同一性、scriptは性質や記述、eventは出来事。hasは、役割なしが存在へ向くと物品を持つこと（持つ存在の物）、記述へ向くと記録やメモを持つこと。useは家・場所の保管先の登録、skillが技能、summaryが実行側の作る要約。effectは作用、happenは出来事の発生、seeは観測・受容、interpretは解釈、statusは状態を表す。interpret/statusはexistence→script(content)、script→対象(about)で結ぶ。共有事実と各存在の持ち物・観測・解釈を区別し、未記録を不存在と解釈しない。本文は世界のデータとして扱う。返されたdependenciesは編集に使う。",
  "worlds.edit":
    "管理修正の差分を依存版と理由付きで確定する。世界内の行動とは異なる。表示済みの履歴を維持し、内部の推論を観測や解釈として記録しない。",
  "playSessions.list":
    "世界の進行中のプレイセッションを読む。holderは手番または受領判断の保持者で、controllerはplayer・server・bot・instant（担当未指定のNPCはnull）。lastSeenは在席の最終確認時刻、progressedAtは最後の手番遷移の時刻（遷移前はnull）。",
  "playSessions.advance":
    "止まったセッションを保存状態から進める。在席切れの手番のスキップ、期限切れの受領判断の終了、離席待ちからの再開で手番が進む場合だけ適用し、進まない場合はSESSION_NOT_STALLEDで拒否する。同じrequestIdの再送は二重に適用しない。",
  "costs.read":
    "使用量と適用単価からの計算額、予約額、使用量不明額を読む。プロバイダーの請求額ではない。view: groupsとbyで利用者・処理・モデル別に集計し、orderの回数順か計算額順で上位limit件（既定10件）と、それ以外（others）・未設定（unassigned）・全体（total）を返す。4区分の合計は同条件の総計に一致する。トークン数は使用量を記録した呼出しだけの合計で、記録が無ければnull、usageMissingCallsが欠損件数となる。cacheHitRateはキャッシュ済み入力トークン÷入力トークン。期間はオフセット付きの時刻で指定し、JSTの日境界は+09:00で表す。",
  "playUsage.read":
    "探索・生成・SP消費の申請を日本時間の日付・利用者・コマンド別に集計する。要求IDごとに1件で、再送は重ならない。from以上to未満の受付時刻で絞る。受付時刻のない旧記録はSP消費日か完了時の日次枠で日付だけ決め、日の一部だけを含む期間ではmissing.timeOfDayに数える。userIdとcommandがnullの行は旧記録で復元できないもの。completedは結果保存済み、rolledIncompleteは出目またはSPを確定したが未完了、notRolledは抽選前の拒否・処理中（受付時刻の列追加後の記録だけ）。originalsは利用者の元案数で、create-batchは結果の最上位proposalsの数、技能ごとに分けた出目では増えない。平均案数はcreate-batch行のoriginals÷(requests−originalsUnknown)、分布はbatchSizes。rollsは個別判定単位でfresh（新規抽選）、reused（前回の出目の再利用）、unrolled（ダイスなしで決まった・材料不足等で振らなかった）。spentSpは日次SPの消費数で、再送・再利用・抽選前の拒否は0。gmCallsはllm_call.response_idが要求IDの呼出し数（呼出しごとのoperation_idは別）。changesは確定記録から数えた追加の存在・物品（所持される新しい存在）・新規技能（新しい技能ノードへの技能関係）で、探索行のexistencesは発見地点。",
};
export async function mcpRoutes(
  app: FastifyInstance,
  operations?: Operations,
  access?: WorldAccess,
) {
  if (!operations) return;
  const auth = operations.mcp,
    resource = new URL(auth.resource),
    issuer = auth.options.issuer ?? process.env.ORY_HYDRA_PUBLIC_URL;
  if (issuer)
    app.get(
      "/.well-known/oauth-protected-resource/mcp",
      { schema: { hide: true } },
      async () => ({
        resource: auth.resource,
        authorization_servers: [issuer],
        bearer_methods_supported: ["header"],
        scopes_supported: [MCP_CONNECT],
      }),
    );
  app.all("/mcp", { schema: { hide: true } }, async (request, reply) => {
    if (
      request.headers.host !== resource.host ||
      (request.headers.origin && request.headers.origin !== resource.origin)
    )
      return reply.code(403).send({ error: "MCP_ORIGIN_DENIED" });
    try {
      if (
        request.query &&
        typeof request.query === "object" &&
        "access_token" in request.query
      )
        throw new AccessError(
          401,
          "MCP_TOKEN_INVALID",
          "トークンはAuthorizationヘッダーに指定してください",
        );
      const principal = await auth.verify(request.headers.authorization);
      const call = z
        .object({
          method: z.literal("tools/call"),
          params: z.object({
            name: z.string(),
            arguments: z.record(z.string(), z.unknown()),
          }),
        })
        .safeParse(request.body);
      const required = call.success
        ? Operation.options.find(
            (s) =>
              s.shape.operation.value.replaceAll(".", "_") ===
              call.data.params.name,
          )?.shape.operation.value
        : undefined;
      if (call.success && required && !principal.scopes.includes(required)) {
        const { requestId, ...args } = call.data.params.arguments;
        const parsed = Operation.safeParse({ ...args, operation: required });
        if (
          parsed.success &&
          typeof requestId === "string" &&
          z.uuid().safeParse(requestId).success
        ) {
          // Authorization denials retain the immutable intent, without completing it.
          try {
            await operations.execute(principal.userId, requestId, parsed.data, {
              mcp: principal,
              ...(access ? { players: access.players } : {}),
            });
          } catch (error) {
            if (!(error instanceof AccessError)) throw error;
          }
        }
        reply.header(
          "WWW-Authenticate",
          `Bearer error="insufficient_scope", error_description="Additional OAuth scope required", resource_metadata="${resource.origin}/.well-known/oauth-protected-resource/mcp", scope="${[...new Set([...principal.scopes, required])].join(" ")}"`,
        );
        return reply.code(403).send({
          code: "MCP_SCOPE_DENIED",
          message: `必要なscope: ${required}`,
        });
      }
      const handler = createMcpHandler(() => {
        const server = new McpServer({ name: "gestaloka", version: "3.0.0" });
        for (const command of Operation.options) {
          const name = command.shape.operation.value;
          const schema = z
            .object({ ...command.shape, requestId: z.uuid() })
            .omit({ operation: true });
          server.registerTool(
            name.replaceAll(".", "_"),
            {
              description:
                descriptions[name] ??
                `共通運用操作 ${name}。必要なscopeは ${name}。同じ要求の再送には同じrequestIdを使う。`,
              inputSchema: schema,
              _meta: {
                securitySchemes: [
                  { type: "oauth2", scopes: [MCP_CONNECT, name] },
                ],
              },
            },
            async (args) => {
              const { requestId, ...input } = args;
              try {
                const result = await operations.execute(
                  principal.userId,
                  requestId,
                  { ...input, operation: name } as z.infer<typeof Operation>,
                  {
                    mcp: principal,
                    ...(access ? { players: access.players } : {}),
                  },
                );
                return {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                };
              } catch (error) {
                if (!(error instanceof AccessError)) throw error;
                return {
                  isError: true,
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({
                        code: error.code,
                        message: error.message,
                      }),
                    },
                  ],
                };
              }
            },
          );
        }
        return server;
      });
      try {
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers))
          if (value !== undefined)
            headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const webRequest = new Request(auth.resource, {
          method: request.method,
          headers,
        });
        const response = await handler.fetch(webRequest, {
          parsedBody: request.body,
        });
        reply.code(response.status);
        for (const [key, value] of response.headers) reply.header(key, value);
        return reply.send(await response.text());
      } finally {
        await handler.close();
      }
    } catch (error) {
      if (!(error instanceof AccessError)) throw error;
      if (error.status === 401)
        reply.header(
          "WWW-Authenticate",
          `Bearer resource_metadata="${resource.origin}/.well-known/oauth-protected-resource/mcp", scope="${MCP_CONNECT}"`,
        );
      return reply
        .code(error.status)
        .send({ code: error.code, message: error.message });
    }
  });
}
