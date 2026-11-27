export { TurnSignals } from "./turn-signals.js";
export { AccessError } from "./access-error.js";
import { AccessError } from "./access-error.js";
import { npcReport } from "../runtime/npc-mode.js";
import { BotPlay } from "../runtime/bot-play.js";
import { playDiceMessages } from "../runtime/play-dice-messages.js";
import type {
  PlayerPlayCommand,
  InventoryBundleCommand,
  PlayerReportInput,
  ViewersInput,
  FriendCommand,
} from "@gestaloka/contracts";
import type { NpcModeCommand } from "@gestaloka/contracts";
import { RuntimeControl, RuntimeStopped } from "../runtime/control.js";
import { PlayerDevices } from "./player-devices.js";
import { Stories, setupStories } from "./stories.js";
import { McpOrigin } from "./mcp-origin.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { seal, unseal } from "../secrets.js";
import type { DescriptionCursor } from "../world/belongings.js";
import type pg from "pg";
import {
  WorldStatus,
  WaitingContextStatus,
  KnowledgePage,
  AdminPage,
  type WorldCommand,
  PlayerStatus,
  PlayRun,
  type SpectatingView,
  type ReceiptResult,
  SceneStatus,
  SceneResponse,
  SceneRecordPage,
  type SceneRecordQuery,
  type CreateWorld,
} from "@gestaloka/contracts";
import {
  ConstructionStateError,
  type WorldConstruction,
} from "../runtime/construction.js";
import { worldNow } from "../world/model.js";
import { WorldConflict } from "../world/store.js";
import { WorldScenes, type SceneRow } from "../runtime/scene.js";
import { sceneAnchors } from "../runtime/scene-data.js";
import { requireMember } from "./operations.js";
import { ExecutionBudget } from "../execution-budget.js";
import { WorldPlayers, type CharacterEvidence } from "../runtime/players.js";
import {
  setupInitialPresentations,
  recordInitialPresentation,
} from "../inspection/record.js";

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const sequence = (value: string) =>
  /^\d{1,19}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const Cursor = z
  .object({ from: z.number().int().nonnegative().safe(), id: z.uuid() })
  .strict();
type Role = "admin" | "player";

type SpectatingChat = {
  entries?: {
    input: string;
    label?: string;
    result?: {
      action?: { command: string };
      effectState?: string;
      outcome?: { success?: boolean };
      state?: string;
    } | null;
  }[];
  comment?: string;
  observation?: string;
  reason?: string;
  receiptResult?: Pick<z.infer<typeof ReceiptResult>, "outcome">;
  transition?: { at: string; message: string };
};
type SpectatingScene = NonNullable<z.infer<typeof SpectatingView>["scene"]>;
const receiptMessages = {
  accepted: "受領が成立しました",
  rejected: "受領が拒否されました",
  expired: "受領判断の期限が切れました",
  cancelled: "受領が取り消されました",
};
function spectatingLines(payload: SpectatingChat) {
  const lines: SpectatingScene["entries"][number]["lines"] = [];
  for (const { input, label, result } of payload.entries ?? []) {
    if (input)
      lines.push({ text: input, ...(label ? { speaker: label } : {}) });
    if (payload.observation || result?.action?.command === "oppose") continue;
    const success = result?.outcome?.success;
    const text =
      success === true
        ? (result?.effectState ?? "成立しました")
        : success === false ||
            result?.state === "failed" ||
            result?.state === "rejected"
          ? "成立しませんでした"
          : result?.state === "receiving"
            ? "受領判断中です"
            : undefined;
    if (text) lines.push({ text: `結果：${text}` });
  }
  if (payload.comment) lines.push({ text: payload.comment });
  if (payload.reason) lines.push({ text: payload.reason });
  if (payload.receiptResult)
    lines.push({ text: receiptMessages[payload.receiptResult.outcome] });
  if (payload.transition) lines.push({ text: payload.transition.message });
  return lines;
}

export class WorldAccess {
  readonly botPlay: BotPlay;
  readonly devices: PlayerDevices;
  readonly scenes: WorldScenes;
  readonly players: WorldPlayers;
  readonly stories: Stories;
  constructor(readonly construction: WorldConstruction) {
    this.botPlay = new BotPlay(construction);
    this.scenes = new WorldScenes(construction);
    this.players = new WorldPlayers(construction);
    this.devices = new PlayerDevices(construction.pool, this.players);
    this.stories = new Stories(construction.pool);
  }
  get pool() {
    return this.construction.pool;
  }

  async setup() {
    await this.construction.setup();
    await this.pool.query(`DO $$ BEGIN
      IF to_regclass('world_subject') IS NULL AND to_regclass('browser_session') IS NOT NULL THEN
        ALTER TABLE browser_session RENAME TO world_subject;
      END IF;
      END $$;
      CREATE TABLE IF NOT EXISTS world_subject (
      id uuid PRIMARY KEY, token_hash text UNIQUE, active boolean NOT NULL DEFAULT true);
      ALTER TABLE world_subject ALTER COLUMN token_hash DROP NOT NULL;
      ALTER TABLE world_subject ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES app_identity(id);
      CREATE INDEX IF NOT EXISTS world_subject_user ON world_subject(user_id,id);
      CREATE TABLE IF NOT EXISTS world_access (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      subject_id uuid NOT NULL REFERENCES world_subject(id), construction_id uuid NOT NULL REFERENCES world_construction(id),
      role text NOT NULL CHECK(role IN ('admin','player')),actor_id uuid);
      DO $$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='world_access'::regclass AND attname='id' AND NOT attisdropped) THEN
          ALTER TABLE world_access ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
          ALTER TABLE world_access DROP CONSTRAINT world_access_pkey;
          ALTER TABLE world_access ADD PRIMARY KEY(id);
        END IF;
      END $$;
      CREATE UNIQUE INDEX IF NOT EXISTS world_access_admin ON world_access(subject_id,construction_id) WHERE role='admin';
      CREATE UNIQUE INDEX IF NOT EXISTS world_access_player ON world_access(subject_id,construction_id,actor_id) WHERE role='player';
      CREATE INDEX IF NOT EXISTS world_access_actor ON world_access(construction_id,actor_id,subject_id) WHERE role='player';
      ALTER TABLE world_access ADD COLUMN IF NOT EXISTS player_slot_released boolean NOT NULL DEFAULT false;
      CREATE INDEX IF NOT EXISTS world_access_player_slot ON world_access(subject_id,construction_id)
        WHERE role='player' AND actor_id IS NOT NULL AND NOT player_slot_released;
      CREATE OR REPLACE FUNCTION guard_subject_grants() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM id FROM world_subject WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.subject_id ELSE NEW.subject_id END FOR SHARE;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END $$;
      CREATE OR REPLACE TRIGGER world_access_subject_guard BEFORE INSERT OR UPDATE OR DELETE ON world_access
      FOR EACH ROW EXECUTE FUNCTION guard_subject_grants();
      CREATE TABLE IF NOT EXISTS api_request (
      id uuid PRIMARY KEY,subject_id uuid NOT NULL REFERENCES world_subject(id),hash text NOT NULL,response jsonb);
      CREATE TABLE IF NOT EXISTS world_event (
      id bigserial PRIMARY KEY,subject_id uuid NOT NULL REFERENCES world_subject(id),
      construction_id uuid NOT NULL REFERENCES world_construction(id),role text NOT NULL,event_key text UNIQUE NOT NULL);
      CREATE INDEX IF NOT EXISTS world_event_scope ON world_event(subject_id,construction_id,role,id);
      CREATE OR REPLACE FUNCTION stamp_world_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended(NEW.construction_id::text,0));
        NEW.id := nextval(pg_get_serial_sequence('world_event','id'));
        RETURN NEW;
      END $$;
      CREATE OR REPLACE TRIGGER world_event_order BEFORE INSERT ON world_event
      FOR EACH ROW EXECUTE FUNCTION stamp_world_event();
      CREATE OR REPLACE FUNCTION notify_construction() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (NEW.state,NEW.at,NEW.target,NEW.participant_id,NEW.error) IS DISTINCT FROM
           (OLD.state,OLD.at,OLD.target,OLD.participant_id,OLD.error) THEN
          INSERT INTO world_event(subject_id,construction_id,role,event_key)
          SELECT subject_id,construction_id,role,gen_random_uuid()::text FROM world_access
          WHERE construction_id=NEW.id AND (role='admin' OR NEW.participant_id IS DISTINCT FROM OLD.participant_id
            OR (role='player' AND (NEW.state IN ('playing','play_paused') OR OLD.state IN ('playing','play_paused'))));
        END IF;
        RETURN NEW;
      END $$;
      CREATE OR REPLACE TRIGGER construction_notification AFTER UPDATE ON world_construction
      FOR EACH ROW EXECUTE FUNCTION notify_construction();`);
    await this.scenes.setup();
    await this.botPlay.setup();
    await setupInitialPresentations(this.pool);
    await this.players.setup();
    await this.devices.setup();
    await setupStories(this.pool);
    await this.pool.query(`INSERT INTO world_controlled_actor(world_id,actor_id)
      SELECT c.world_id,a.actor_id FROM world_access a JOIN world_construction c ON c.id=a.construction_id
      WHERE a.role='player' AND a.actor_id IS NOT NULL AND c.world_id IS NOT NULL ON CONFLICT DO NOTHING`);
  }

  async authorize(
    subject: string,
    id: string,
    role: Role,
    client: Pick<pg.Pool, "query"> = this.pool,
    actorId?: string,
  ) {
    await requireMember(client, subject, role === "admin");
    if (role === "admin") {
      const exists = await client.query(
        "SELECT id FROM world_construction WHERE id=$1",
        [id],
      );
      if (!exists.rowCount)
        throw new AccessError(
          404,
          "WORLD_NOT_FOUND",
          "利用できる世界が見つかりません",
        );
      return { actor_id: null };
    }
    const row = (
      await client.query<{ actor_id: string | null }>(
        `SELECT DISTINCT a.actor_id FROM world_access a JOIN world_subject s ON s.id=a.subject_id
       WHERE s.user_id=$1 AND a.construction_id=$2 AND a.role=$3 AND s.active
       AND (($4::uuid IS NOT NULL AND a.actor_id=$4) OR ($4::uuid IS NULL AND NOT EXISTS (
         SELECT 1 FROM world_join j WHERE j.id=a.id AND j.hidden_from_selection))) LIMIT 2`,
        [subject, id, role, actorId ?? null],
      )
    ).rows;
    if (row.length > 1)
      throw new AccessError(
        409,
        "ACTOR_REQUIRED",
        "操作する存在を選んでください",
      );
    if (!row[0])
      throw new AccessError(
        404,
        "WORLD_NOT_FOUND",
        "利用できる世界が見つかりません",
      );
    return row[0];
  }
  private async playCharacters<T extends Record<string, unknown>>(
    world: string,
    result: T,
    device?: string,
  ) {
    if (!Array.isArray(result.characters)) return result;
    const people = result.characters as {
      actorId: string;
      name: string;
      count?: number;
    }[];
    // Old request journals can contain images. Project names even when replaying one.
    const icons = device
      ? []
      : (
          await this.pool.query<{ actor_id: string; image: string | null }>(
            `SELECT DISTINCT ON (a.actor_id) a.actor_id,i.image FROM world_access a JOIN world_player_icon i ON i.player_id=a.id WHERE a.construction_id=$1 AND a.actor_id=ANY($2::uuid[]) ORDER BY a.actor_id,a.id`,
            [world, people.map((p) => p.actorId)],
          )
        ).rows;
    return {
      ...result,
      characters: people.map(({ actorId, name, count }) => ({
        actorId,
        name,
        ...(count !== undefined ? { count } : {}),
        ...(device
          ? {}
          : { icon: icons.find((r) => r.actor_id === actorId)?.image ?? null }),
      })),
    };
  }
  async botCommand(
    subject: string,
    id: string,
    input: z.infer<typeof PlayerPlayCommand>,
    actorId?: string,
    connectionId?: string,
    expectedSp?: number,
  ) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      actorId,
    );
    const result = await this.botPlay
      .submit(
        id,
        grant.actor_id!,
        input,
        subject,
        undefined,
        connectionId,
        expectedSp,
      )
      .catch(async (error) => {
        if (!(error instanceof AccessError)) throw error;
        throw new AccessError(
          error.status,
          error.code,
          error.message,
          (await this.botPlay.current(id, grant.actor_id!))?.data.used,
          error.inventory,
          error.blockingStates,
        );
      });
    return Object.assign(
      await this.playCharacters(id, result, connectionId),
      (await this.botPlay.unread(id, grant.actor_id!)) as Record<
        string,
        unknown
      >,
    );
  }
  async botQuote(
    subject: string,
    id: string,
    input: z.infer<typeof PlayerPlayCommand>,
    actorId?: string,
  ) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      actorId,
    );
    return this.botPlay.quote(id, grant.actor_id!, input);
  }
  async friend(
    subject: string,
    id: string,
    input: z.infer<typeof FriendCommand>,
    actorId?: string,
  ) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      actorId,
    );
    const actor = grant.actor_id!;
    return this.#accept(
      subject,
      input.requestId,
      { operation: "friend", worldId: id, actorId: actor, input },
      "player",
      async (db) => {
        await RuntimeControl.check(db, { userId: subject }, true);
        return this.botPlay.friend(db, id, actor, input);
      },
    );
  }
  async setViewers(
    subject: string,
    id: string,
    input: z.infer<typeof ViewersInput>,
    actorId?: string,
  ) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      actorId,
    );
    return this.botPlay.setViewers(id, grant.actor_id!, input);
  }
  async notices(subject: string, id: string, actorId?: string) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      actorId,
    );
    return this.botPlay.notices(id, grant.actor_id!);
  }
  async inventoryDescription(
    subject: string,
    id: string,
    item: string,
    secret: string,
    after?: string,
    actorId?: string,
  ) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      actorId,
    );
    const label = JSON.stringify([id, grant.actor_id, item]);
    let cursor: DescriptionCursor | undefined;
    if (after) {
      try {
        cursor = JSON.parse(
          unseal(secret, "inventory-description", label, after),
        );
      } catch {
        throw new AccessError(
          400,
          "INVALID_CURSOR",
          "この品の説明の続きを指定してください",
        );
      }
    }
    const description = await this.botPlay.inventoryDescription(
      id,
      grant.actor_id!,
      item,
      cursor,
    );
    if (!description)
      throw new AccessError(
        404,
        "ITEM_NOT_HELD",
        "手持ちの品を指定してください",
      );
    return {
      ...description,
      next: description.next
        ? seal(
            secret,
            "inventory-description",
            label,
            JSON.stringify(description.next),
          )
        : null,
    };
  }
  async inventoryContents(
    subject: string,
    id: string,
    container: string,
    after?: string,
    actorId?: string,
  ) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      actorId,
    );
    const contents = await this.botPlay.inventoryContents(
      id,
      grant.actor_id!,
      container,
      after,
    );
    if (!contents)
      throw new AccessError(
        404,
        "CONTAINER_NOT_AVAILABLE",
        "持ち物や登録した保管先にある入れ物、またはバンドルを指定してください",
      );
    return contents;
  }
  async editInventoryBundle(
    subject: string,
    id: string,
    input: z.infer<typeof InventoryBundleCommand>,
    actorId?: string,
  ) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      actorId,
    );
    return this.botPlay.editInventoryBundle(id, grant.actor_id!, input);
  }
  async spectate(
    subject: string,
    id: string,
    actorId: string,
    before?: string,
  ): Promise<z.infer<typeof SpectatingView>> {
    // 認可と観戦対象の記録を同じスナップショットで読む。
    const pageSize = 50;
    const { rows } = await this.pool.query<{
      world_id: string;
      scene_id: string | null;
      chat_id: string | null;
      recorded_at: Date | null;
      payload: SpectatingChat | null;
    }>(
      `SELECT c.world_id,s.id AS scene_id,r.chat_id,b.recorded_at,b.payload
       FROM world_construction c
       LEFT JOIN bot_scene s ON s.world_id=c.id AND s.actor_id=$2 AND NOT s.closed
       LEFT JOIN LATERAL (
         SELECT chat_id FROM bot_record
         WHERE scene_id=s.id AND actor_id=$2 AND chat_id<=coalesce($4::bigint-1,9223372036854775807)
         ORDER BY chat_id DESC LIMIT $5
       ) r ON true
       LEFT JOIN bot_chat b ON b.id=r.chat_id
       WHERE c.id=$1 AND c.world_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM world_access a
           JOIN world_subject owner ON owner.id=a.subject_id AND owner.active
           JOIN app_user u ON u.id=owner.user_id AND u.public_spectating AND NOT u.banned
           WHERE a.construction_id=c.id AND a.role='player' AND a.actor_id=$2
         )
         AND (c.published OR EXISTS (
           SELECT 1 FROM world_subject viewer JOIN world_access a ON a.subject_id=viewer.id
           WHERE viewer.user_id=$3 AND viewer.active AND a.construction_id=c.id AND a.role='player'
         ))
       ORDER BY r.chat_id DESC`,
      [id, actorId, subject, before ?? null, pageSize + 1],
    );
    const first = rows[0];
    if (!first)
      throw new AccessError(
        404,
        "SPECTATING_UNAVAILABLE",
        "このプレイは観戦できません",
      );
    const name =
      (await this.botPlay.store.context(first.world_id).node(actorId))?.text ??
      "プレイヤー";
    if (!first.scene_id) return { name, scene: null };
    const beforePage =
      rows.length > pageSize ? rows[pageSize - 1]!.chat_id : null;
    const entries = rows
      .slice(0, pageSize)
      .reverse()
      .flatMap((row) => {
        if (!row.chat_id || !row.payload) return [];
        const lines = spectatingLines(row.payload);
        if (!lines.length) return [];
        const at = row.recorded_at?.toISOString() ?? row.payload.transition?.at;
        return [{ id: row.chat_id, ...(at ? { at } : {}), lines }];
      });
    return {
      name,
      scene: {
        id: first.scene_id,
        entries,
        before: beforePage,
      },
    };
  }

  private async botStatusActor(
    subject: string,
    id: string,
    actorId?: string,
    connectionId?: string,
  ) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      actorId,
    );
    await this.botPlay.keepAlive(
      id,
      grant.actor_id!,
      subject,
      connectionId ?? `human:${subject}`,
    );
    await this.botPlay.expire(id);
    return grant.actor_id!;
  }
  async botStatus(
    subject: string,
    id: string,
    actorId?: string,
    sceneId?: string,
    connectionId?: string,
    after?: string,
    screen = false,
  ) {
    const viewerId = await this.botStatusActor(
      subject,
      id,
      actorId,
      connectionId,
    );
    // 世界が更新されたら画面の読み取りをやり直す。期限処理と配達は再実行しない。
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.#readBotStatus(
          subject,
          id,
          viewerId,
          screen,
          sceneId,
          connectionId,
          after,
        );
      } catch (error) {
        if (!screen || !(error instanceof WorldConflict) || attempt >= 3)
          throw error;
      }
    }
  }
  async #readBotStatus(
    subject: string,
    id: string,
    viewerId: string,
    screen: boolean,
    sceneId?: string,
    connectionId?: string,
    after?: string,
  ) {
    const status = await this.botPlay.status(id, viewerId, this.pool, screen);
    const history = await this.botPlay.history(
      id,
      viewerId,
      sceneId,
      this.pool,
      after,
      screen,
    );
    for (const { payload } of history.entries) {
      for (const entry of payload.entries ?? []) {
        const dice = playDiceMessages(entry.result?.outcome);
        if (dice.length) entry.result.dice = dice;
      }
    }
    const result = {
      viewerId,
      ...status,
      dailySp: await this.botPlay.dailySp(id, viewerId),
      ...history,
      ...(await this.botPlay.unread(id, viewerId)),
    };
    if (!screen) return this.playCharacters(id, result, connectionId);
    const characters = new Map<
      string,
      { actorId: string; name: string; count?: number }
    >();
    if (
      history.sceneId &&
      !status.members?.some(
        (member) =>
          member.sceneId === history.sceneId && member.actorId === viewerId,
      )
    ) {
      for (const { payload } of history.entries) {
        for (const entry of payload.entries ?? [])
          characters.set(entry.actorId, {
            actorId: entry.actorId,
            name: entry.label ?? "参加者",
          });
        if (payload.transition) {
          const { actorId, name } = payload.transition;
          characters.set(actorId, { actorId, name });
        }
      }
    } else {
      for (const character of status.characters ?? [])
        characters.set(character.actorId, character);
    }
    const details = await this.botPlay.screen(id, viewerId, [
      ...characters.keys(),
    ]);
    if (!characters.has(viewerId)) characters.set(viewerId, details.own);
    const { aiControlled } = (
      await this.pool.query<{ aiControlled: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM player_device d
           LEFT JOIN world_join j ON j.id=d.id AND j.subject_id=d.user_id
           WHERE d.world_id=$1 AND d.user_id=$2 AND NOT d.revoked
             AND coalesce(d.actor_id,j.actor_id)=$3
           UNION ALL
           SELECT 1 FROM bot_npc
           WHERE world_id=$1 AND actor_id=$3 AND controller IS NOT NULL
         ) AS "aiControlled"`,
        [id, subject, viewerId],
      )
    ).rows[0]!;
    return this.playCharacters(
      id,
      {
        ...result,
        aiControlled,
        characters: [...characters.values()],
        screen: details,
      },
      connectionId,
    );
  }
  async botStatusView(
    subject: string,
    id: string,
    view: "wait" | "joins",
    actorId?: string,
    connectionId?: string,
    after = "0",
  ) {
    const viewerId = await this.botStatusActor(
      subject,
      id,
      actorId,
      connectionId,
    );
    const state = await this.botPlay.status(id, viewerId);
    if (view === "wait")
      return {
        viewerId,
        view,
        waitingForReturn: state.waitingForReturn ?? null,
      };
    const sceneId = state.members?.find(
      (member) => member.actorId === viewerId,
    )?.sceneId;
    return {
      viewerId,
      view,
      sessionId: state.sessionId ?? null,
      turn: state.turn ?? null,
      turnHolder:
        state.characters?.find((member) => member.actorId === state.actorId) ??
        null,
      characters: state.characters ?? [],
      entries: sceneId
        ? await this.botPlay.joinHistory(sceneId, viewerId, after)
        : [],
    };
  }
  private async reportActor(
    subject: string,
    id: string,
    actorId: string | undefined,
    deviceId: string | undefined,
    db: Pick<pg.Pool, "query">,
  ) {
    if (deviceId && !actorId) {
      const pending = await db.query(
        "SELECT 1 FROM player_device WHERE id=$1 AND user_id=$2 AND world_id=$3 AND NOT revoked AND (character_approved OR preset_id IS NOT NULL) FOR SHARE",
        [deviceId, subject, id],
      );
      if (!pending.rowCount)
        throw new AccessError(
          403,
          "PLAYER_DEVICE_DENIED",
          "この世界への端末の許可を確認してください",
        );
      return null;
    }
    return (await this.authorize(subject, id, "player", db, actorId)).actor_id!;
  }
  async reportStatus(
    subject: string,
    id: string,
    actorId?: string,
    deviceId?: string,
  ) {
    await this.reportActor(subject, id, actorId, deviceId, this.pool);
    return this.botPlay.tools.reportStatus(this.pool, subject, id);
  }
  async waiting(
    subject: string,
    id: string,
    actorId?: string,
    connectionId = `human:${subject}`,
    active?: boolean,
    renew = true,
    includeContext = false,
  ) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      actorId,
    );
    await this.botPlay.expire(id);
    return WaitingContextStatus.parse(
      await this.botPlay.waiting(
        id,
        grant.actor_id!,
        subject,
        connectionId,
        active,
        this.pool,
        renew,
        includeContext,
      ),
    );
  }
  async report(
    subject: string,
    id: string,
    input: z.infer<typeof PlayerReportInput>,
    actorId?: string,
    deviceId?: string,
  ) {
    const actor = await this.reportActor(
      subject,
      id,
      actorId,
      deviceId,
      this.pool,
    );
    const body = {
      operation: "player-report",
      worldId: id,
      actorId: actor,
      requestId: input.requestId,
      text: input.text,
    };
    return this.#accept(
      subject,
      input.requestId,
      body,
      "player",
      async (db) => {
        const author = await this.reportActor(
          subject,
          id,
          actorId,
          deviceId,
          db,
        );
        return this.botPlay.tools.report(db, subject, id, author, input);
      },
      // The same request can be replayed after its sender has finished joining.
      actor ? { ...body, actorId: null } : undefined,
    );
  }
  async promotions(
    subject: string,
    id: string,
    actorId?: string,
    before?: string,
  ) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      actorId,
    );
    return this.botPlay.tools.promotions(
      this.pool,
      id,
      grant.actor_id!,
      before,
    );
  }
  async #accept<T>(
    subject: string,
    requestId: string,
    body: unknown,
    role: Role,
    perform: (client: pg.PoolClient) => Promise<T>,
    previousBody?: unknown,
  ) {
    const hash = digest(JSON.stringify(body));
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await requireMember(client, subject, role === "admin");
      await client.query(
        "INSERT INTO world_subject(id,user_id) VALUES($1,$1) ON CONFLICT DO NOTHING",
        [subject],
      );
      await client.query(
        "INSERT INTO api_request(id,subject_id,hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [requestId, subject, hash],
      );
      const saved = (
        await client.query<{
          subject_id: string;
          hash: string;
          response: T | null;
        }>("SELECT * FROM api_request WHERE id=$1 FOR UPDATE", [requestId])
      ).rows[0]!;
      const owner = await client.query(
        "SELECT id FROM world_subject WHERE id=$1 AND user_id=$2 AND active",
        [saved.subject_id, subject],
      );
      if (
        !owner.rowCount ||
        (saved.hash !== hash &&
          (previousBody === undefined ||
            saved.hash !== digest(JSON.stringify(previousBody))))
      )
        throw new AccessError(
          409,
          "REQUEST_CONFLICT",
          "同じ要求IDに異なる内容は使用できません",
        );
      const response =
        saved.response ??
        (await McpOrigin.run(McpOrigin.current ?? null, () => perform(client)));
      if (saved.response === null)
        await client.query("UPDATE api_request SET response=$2 WHERE id=$1", [
          requestId,
          JSON.stringify(response),
        ]);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof RuntimeStopped)
        throw new AccessError(409, error.code, error.message);
      throw error;
    } finally {
      client.release();
    }
  }
  statusData(row: Awaited<ReturnType<WorldConstruction["get"]>>) {
    return WorldStatus.parse({
      id: row.id,
      prompt: row.initial_prompt,
      playerSettings: row.player_settings,
      startingItems: row.starting_items,
      createdAt: row.created_at.toISOString(),
      state: row.state,
      at: row.at,
      target: row.target,
      hasParticipant: row.participant_id !== null,
      publication: {
        title: row.public_title,
        description: row.public_description,
        published: row.published,
        accepting: row.accepting,
        playerList: row.player_list,
        instantNpcMultiplier: row.instant_npc_multiplier,
        deathJudgment: row.death_judgment,
        respawnEnabled: row.respawn_enabled,
        deathCriteria: row.death_criteria,
        deathPlaceId: row.death_place_id,
        nonCombatAreas: row.non_combat_areas,
        nonCombatPlaceSeries: row.non_combat_place_series,
      },
      error: row.error,
    });
  }
  async create(subject: string, input: z.infer<typeof CreateWorld>) {
    return this.#accept(
      subject,
      input.requestId,
      { operation: "create", ...input },
      "admin",
      async (client) => {
        const id = await this.construction.create(
          input.prompt,
          input.budgetUsd,
          client,
          input.playerSettings,
        );
        await client.query(
          "UPDATE world_construction SET user_id=$2,request_id=$3 WHERE id=$1",
          [id, subject, input.requestId],
        );
        await ExecutionBudget.attribute(client, id, subject, { role: "admin" });
        await client.query(
          "UPDATE world_budget SET updated_by=$2 FROM world_build b WHERE world_budget.world_id=b.world_id AND b.run_id=$1",
          [id, subject],
        );
        await client.query(
          "INSERT INTO world_access(subject_id,construction_id,role) VALUES($1,$2,'admin')",
          [subject, id],
        );
        await client.query(
          "INSERT INTO world_event(subject_id,construction_id,role,event_key) VALUES($1,$2,'admin',$3)",
          [subject, id, input.requestId],
        );
        return this.statusData(await this.construction.get(id, client));
      },
    );
  }
  async command(
    subject: string,
    id: string,
    input: z.infer<typeof WorldCommand>,
  ) {
    await this.authorize(subject, id, "admin");
    return this.#accept(
      subject,
      input.requestId,
      { id, ...input },
      "admin",
      async (client) => {
        await this.authorize(subject, id, "admin", client);
        let row;
        try {
          row = await this.construction.command(
            id,
            input.command,
            "duration" in input ? input.duration : undefined,
            client,
          );
        } catch (error) {
          if (error instanceof ConstructionStateError)
            throw new AccessError(409, "STATE_CONFLICT", error.message);
          throw error;
        }
        if (input.command === "advance")
          await client.query(
            "UPDATE world_construction SET user_id=$2,request_id=$3 WHERE id=$1",
            [id, subject, input.requestId],
          );
        return this.statusData(row);
      },
    );
  }
  async status(subject: string, id: string) {
    await this.authorize(subject, id, "admin");
    const row = await this.construction.get(id);
    const world = this.statusData(row);
    if (!row.world_id) return world;
    const { limits, enabled } = await this.construction.agent.store
      .context(row.world_id)
      .inventorySettings();
    return { ...world, inventoryLimits: limits, inventoryCapacity: enabled };
  }
  async playerData(
    row: Awaited<ReturnType<WorldConstruction["get"]>>,
    database: Pick<pg.Pool, "query"> = this.pool,
    actorId = row.participant_id,
  ) {
    const last = (
      await database.query<{ id: string }>(
        "SELECT id FROM world_run WHERE construction_id=$1 AND actor_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
        [row.id, actorId],
      )
    ).rows[0];
    return PlayerStatus.parse({
      id: row.id,
      viewerId: actorId,
      runId: last?.id ?? null,
      at: worldNow(row),
      state:
        row.state === "play_paused"
          ? "paused"
          : row.state === "playing"
            ? "running"
            : "ready",
      error:
        row.state === "play_paused"
          ? "処理を保留しました。保存済みの状態から再開できます。"
          : null,
    });
  }
  async player(subject: string, id: string, actorId?: string) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      actorId,
    );
    const row = await this.construction.get(id);
    const scene = await this.scenes.latest(
      id,
      this.pool,
      true,
      grant.actor_id!,
    );
    return {
      ...(await this.playerData(row, this.pool, grant.actor_id!)),
      at: scene && scene.state !== "result" ? scene.data.at : worldNow(row),
      error:
        scene?.state === "paused" ||
        (grant.actor_id === row.participant_id && row.state === "play_paused")
          ? "処理を保留しました。保存済みの状態から再開できます。"
          : null,
      state: scene
        ? scene.state === "paused"
          ? ("paused" as const)
          : ["preparing", "acting", "reflecting"].includes(scene.state)
            ? ("running" as const)
            : ("ready" as const)
        : grant.actor_id === row.participant_id &&
            ["playing", "play_paused"].includes(row.state)
          ? row.state === "playing"
            ? ("running" as const)
            : ("paused" as const)
          : ("ready" as const),
    };
  }
  async sceneData(
    row: SceneRow | null,
    compact = false,
    viewerId?: string,
    db: Pick<pg.Pool, "query"> = this.pool,
  ) {
    if (!row) return { scene: null };
    const viewer = viewerId ?? row.actor_id;
    let shared = row.data.shared
      ? await this.scenes.shared.state(row.id, viewer, db)
      : undefined;
    let waiting = await this.scenes.shared.waiting(row.id, db);
    const actualState = row.state;
    const presentation = await this.scenes.sessions.present(
      row,
      viewer,
      compact,
      db,
    );
    row = presentation.row;
    if (shared && presentation.closed) shared = { ...shared, flow: "closing" };
    if (row.state === "result") waiting = [];
    else if (row.state === "reflecting" && actualState !== "reflecting")
      waiting = [
        {
          kind: "system",
          actors: [],
          reason: "リザルトを生成しています",
          deadline: null,
        },
      ];
    if (row.state === "acting" && actualState !== "acting")
      waiting = [
        {
          kind: "system",
          actors: [],
          reason: "行動の結果を生成しています",
          deadline: null,
        },
      ];
    const d = row.data;
    const synopsis =
      viewer === row.actor_id
        ? d.background?.synopsis
        : d.background?.perceptions
            .filter((p) => p.observerId === viewer)
            .map((p) => p.text)
            .join("\n\n");
    const synopsisInformation =
      viewer === row.actor_id ? d.background?.synopsisInformation : undefined;
    const result =
      viewer === row.actor_id ? d.result : d.participantResults?.[viewer]?.text;
    const resultInformation =
      viewer === row.actor_id
        ? d.resultInformation
        : d.participantResults?.[viewer]?.information;
    const messages = compact
      ? []
      : d.events.flatMap((e) =>
          e.receipts
            .filter((p) => p.observerId === viewer)
            .map((p) => ({
              id: e.id,
              text: p.text,
              ids: (p.information ?? []).map((i) => i.id),
            })),
        );
    const ownActions = d.actions.filter(
      (a) => (a.actorId ?? row.actor_id) === viewer,
    );
    const actions = compact ? ownActions.slice(-1) : ownActions;
    const characters = await this.players.characters(
      row.construction_id,
      viewer,
      [
        {
          ids: [
            ...(synopsisInformation ?? []).map((i) => i.id),
            ...(d.background?.perceptions ?? [])
              .filter((p) => p.observerId === viewer)
              .flatMap((p) => p.sourceIds),
          ],
          text: synopsis ?? "",
        },
        {
          ids:
            row.state === "result"
              ? (resultInformation ?? []).map((i) => i.id)
              : [],
          text: row.state === "result" ? (result ?? "") : "",
        },
        ...messages,
        ...actions.map((a) => ({
          ids: [viewer],
          text: a.text,
          own: true,
        })),
      ],
    );
    return {
      scene: SceneStatus.parse({
        id: row.id,
        requestId: shared?.requestIds.at(-1) ?? d.commandId,
        shared,
        waiting,
        viewerId: viewer,
        at: d.at,
        state: row.state,
        synopsis: synopsis ?? null,
        synopsisCharacters: characters[0],
        result: row.state === "result" ? (result ?? null) : null,
        resultCharacters: characters[1],
        error:
          row.state === "paused"
            ? d.limitReached
              ? "応答生成のcall回数上限に達しました。管理者による上限の見直し後、保存したシーンから再開できます。"
              : "処理を保留しました。保存したシーンから再開できます。"
            : null,
        messages: messages.map((m, i) => ({
          id: m.id,
          text: m.text,
          characters: characters[i + 2],
        })),
        actions: actions.map((a, i) => ({
          ...a,
          characters: characters[i + 2 + messages.length],
        })),
        recordIds:
          !compact && d.background
            ? sceneAnchors(
                d.background,
                d.events,
                d.startedAt,
                presentation.anchorId,
              )
                .edges.filter((e) => e.kind === "see" && e.source === viewer)
                .map((e) => e.id)
            : [],
        nextPurpose: d.nextPurpose ?? null,
        ...(d.encounter ? { waitingInvitation: true } : {}),
        ...(d.soloProposal ? { soloProposal: d.soloProposal } : {}),
        ...(d.departures?.[viewer] === undefined ? {} : { departed: true }),
        ...(d.waitingFor?.length ? { waitingFor: d.waitingFor } : {}),
      }),
    };
  }
  async scene(
    subject: string,
    id: string,
    compact = false,
    actorId?: string,
    sceneId?: string,
  ) {
    const grant = await this.authorize(
        subject,
        id,
        "player",
        this.pool,
        actorId,
      ),
      row = await this.scenes.latest(
        id,
        this.pool,
        compact,
        grant.actor_id!,
        sceneId,
      );
    if (sceneId && !row)
      throw new AccessError(
        404,
        "SCENE_NOT_FOUND",
        "閲覧できるプレイ履歴が見つかりません",
      );
    if (
      row &&
      row.actor_id !== grant.actor_id &&
      !(
        row.data.shared &&
        (await this.scenes.shared.members(row.id)).some(
          (m) => m.actor_id === grant.actor_id,
        )
      )
    )
      throw new AccessError(
        403,
        "ACTOR_CHANGED",
        "操作対象を再取得してください",
      );
    return this.sceneData(row, compact, grant.actor_id!);
  }
  async sceneRecords(
    subject: string,
    id: string,
    input: z.infer<typeof SceneRecordQuery>,
  ) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      input.actorId,
    );
    const session = await this.scenes.sessions.get(
      input.sceneId,
      grant.actor_id!,
    );
    const row = (
      await this.pool.query<{
        count: number;
        actor_id: string;
        shared: boolean;
      }>(
        "SELECT actor_id,data ? 'shared' AS shared,jsonb_array_length(data->$3) AS count FROM world_scene WHERE id=$1 AND construction_id=$2 AND (actor_id=$4 OR EXISTS(SELECT 1 FROM world_scene_member m WHERE m.scene_id=world_scene.id AND m.actor_id=$4))",
        [input.sceneId, id, input.kind, grant.actor_id],
      )
    ).rows[0];
    if (!row)
      throw new AccessError(
        404,
        "SCENE_NOT_FOUND",
        "閲覧できるプレイ履歴が見つかりません",
      );
    if (session)
      row.count =
        input.kind === "events" ? session.event_count : session.action_count;
    let position = row.count;
    const raw = input.after || input.before;
    if (raw) {
      try {
        const cursor = z
          .object({
            sceneId: z.literal(input.sceneId),
            kind: z.literal(input.kind),
            index: z.number().int().min(-1).safe(),
            actorId: z.uuid().optional(),
          })
          .parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
        position = cursor.index;
        if (row.shared && cursor.actorId !== grant.actor_id)
          throw new Error("cursor scope");
      } catch {
        throw new AccessError(
          409,
          "CURSOR_INVALID",
          "履歴を再取得してください",
        );
      }
    }
    const low = input.after ? position + 1 : Math.max(0, position - 50),
      high = Math.min(
        row.count - 1,
        input.after ? position + 50 : position - 1,
      );
    const rows = session
      ? (
          await this.scenes.sessions.records(
            input.sceneId,
            grant.actor_id!,
            input.kind,
            this.pool,
            low,
            high,
          )
        ).reverse()
      : (
          await this.pool.query<{
            item: SceneRow["data"]["events"][number] &
              SceneRow["data"]["actions"][number];
          }>(
            "SELECT data->$3->n AS item FROM world_scene CROSS JOIN generate_series($4::int,$5::int) n WHERE id=$1 AND construction_id=$2 ORDER BY n DESC",
            [input.sceneId, id, input.kind, low, high],
          )
        ).rows;
    const encode = (index: number) =>
      Buffer.from(
        JSON.stringify({
          sceneId: input.sceneId,
          kind: input.kind,
          index,
          ...(row.shared ? { actorId: grant.actor_id } : {}),
        }),
      ).toString("base64url");
    const ownRows = rows.filter(
      ({ item }) =>
        input.kind !== "actions" ||
        (item.actorId ?? row.actor_id) === grant.actor_id,
    );
    const evidence: CharacterEvidence[] = ownRows.map(({ item }) => ({
      ids:
        input.kind === "actions"
          ? [grant.actor_id!]
          : [
              ...item.receipts
                .filter((p) => p.observerId === grant.actor_id)
                .flatMap((p) => (p.information ?? []).map((i) => i.id)),
            ],
      text:
        input.kind === "actions"
          ? item.text
          : item.receipts
              .filter((p) => p.observerId === grant.actor_id)
              .map((p) => p.text)
              .join("\n\n"),
      own: input.kind === "actions",
    }));
    const characters = await this.players.characters(
      id,
      grant.actor_id!,
      evidence,
    );
    return SceneRecordPage.parse({
      viewerId: grant.actor_id,
      items: ownRows.flatMap(({ item }, index) => {
        const text =
          input.kind === "actions"
            ? item.text
            : item.receipts
                .filter((p) => p.observerId === grant.actor_id)
                .map((p) => p.text)
                .join("\n\n");
        return text
          ? [
              {
                id: item.id,
                text,
                at: input.kind === "events" ? item.period.from : null,
                kind: input.kind === "events" ? "message" : "action",
                characters: characters[index],
                continuation:
                  item.state === "boundary" ? "続きは次のシーンで" : null,
              },
            ]
          : [];
      }),
      next: low > 0 ? encode(low) : null,
      previous: high < row.count - 1 ? encode(high) : null,
    });
  }
  async sceneCommand(
    ...args: [subject: string, id: string, ...unknown[]]
  ): Promise<z.infer<typeof SceneResponse>> {
    await this.authorize(
      args[0],
      args[1],
      "player",
      this.pool,
      typeof args[4] === "string" ? args[4] : undefined,
    );
    throw new AccessError(
      409,
      "PLAY_API_CHANGED",
      "通常プレイは/api/worlds/:id/sessionと新しいCLIを利用してください。保存済みの履歴は引き続き取得できます。",
    );
  }
  async npcMode(
    ...args: [
      subject: string,
      world: string,
      actorId?: string,
      input?: z.infer<typeof NpcModeCommand>,
      kind?: "human" | "bot",
    ]
  ) {
    const grant = await this.authorize(
      args[0],
      args[1],
      "player",
      this.pool,
      args[2],
    );
    if (args[3])
      throw new AccessError(
        409,
        "PLAY_API_CHANGED",
        "NPCの操作担当は管理者がnpcs.putで個体ごとに指定してください。",
      );
    const report = await npcReport(this.pool, args[1], grant.actor_id!);
    const assigned = (
      await this.pool.query(
        "SELECT controller FROM bot_npc WHERE world_id=$1 AND actor_id=$2",
        [args[1], grant.actor_id],
      )
    ).rows[0];
    return { ...report, active: assigned?.controller === "server" };
  }
  async presence(
    subject: string,
    id: string,
    ...rest: unknown[]
  ): Promise<never> {
    await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      typeof rest[2] === "string" ? rest[2] : undefined,
    );
    throw new AccessError(
      409,
      "PLAY_API_CHANGED",
      "通常プレイは/api/worlds/:id/sessionと新しいCLIを利用してください。",
    );
  }
  async inbox(subject: string, id: string, ...rest: unknown[]): Promise<never> {
    await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      typeof rest[0] === "string" ? rest[0] : undefined,
    );
    throw new AccessError(
      409,
      "PLAY_API_CHANGED",
      "通常プレイは/api/worlds/:id/sessionと新しいCLIを利用してください。",
    );
  }
  async run(subject: string, id: string) {
    const row = (
      await this.pool.query<{
        id: string;
        construction_id: string;
        actor_id: string;
        action_text: string;
        state: string;
        started_at: string;
        at: string;
      }>("SELECT * FROM world_run WHERE id=$1", [id])
    ).rows[0];
    if (!row)
      throw new AccessError(
        404,
        "RUN_NOT_FOUND",
        "利用できる実行が見つかりません",
      );
    const grant = await this.authorize(
      subject,
      row.construction_id,
      "player",
      this.pool,
      row.actor_id,
    );
    if (grant.actor_id !== row.actor_id)
      throw new AccessError(
        404,
        "RUN_NOT_FOUND",
        "利用できる実行が見つかりません",
      );
    return PlayRun.parse({
      id: row.id,
      viewerId: row.actor_id,
      worldId: row.construction_id,
      actionText: row.action_text,
      startedAt: Number(row.started_at),
      at: Number(row.at),
      state: row.state,
      error:
        row.state === "paused"
          ? "処理を保留しました。保存済みの状態から再開できます。"
          : null,
    });
  }
  async play(
    ...args: [subject: string, id: string, ...unknown[]]
  ): Promise<z.infer<typeof PlayerStatus>> {
    await this.authorize(args[0], args[1], "player");
    throw new AccessError(
      409,
      "PLAY_API_CHANGED",
      "通常プレイは/api/worlds/:id/sessionと新しいCLIを利用してください。",
    );
  }

  async list(subject: string) {
    const member = await requireMember(this.pool, subject);
    return (
      await this.pool.query<{ id: string }>(
        member.role === "admin"
          ? "SELECT id FROM world_construction ORDER BY id"
          : "SELECT DISTINCT a.construction_id AS id FROM world_access a JOIN world_subject s ON s.id=a.subject_id WHERE s.user_id=$1 AND s.active AND a.role='player' ORDER BY id",
        member.role === "admin" ? [] : [subject],
      )
    ).rows;
  }
  async records(subject: string, id: string, before?: string, after?: string) {
    await this.authorize(subject, id, "admin");
    if ((before && !sequence(before)) || (after && !sequence(after)))
      throw new AccessError(409, "CURSOR_INVALID", "履歴を再取得してください");
    const rows = (
      await this.pool.query<{
        id: string;
        at: string;
        result: {
          summary: string;
          continuation?: string;
          changes: { nodes: unknown[]; edges: unknown[] };
        };
      }>(
        `SELECT id::text,at::text,result FROM construction_log WHERE construction_id=$1 AND ($2::bigint IS NULL OR id${after ? ">" : "<"}$2) ORDER BY construction_log.id ${after ? "ASC" : "DESC"} LIMIT 51`,
        [id, after || before || null],
      )
    ).rows;
    const page = rows.slice(0, 50);
    if (after) page.reverse();
    const items = page.map((row) => ({
      id: row.id,
      at: Number(row.at),
      summary: row.result.summary,
      continuation: row.result.continuation ?? null,
      counts: {
        nodes: row.result.changes.nodes.length,
        edges: row.result.changes.edges.length,
      },
    }));
    if (!after && rows.length < 50) {
      const initial = (
        await this.pool.query<{
          result: {
            report: string;
            changes: { nodes: unknown[]; edges: unknown[] };
          } | null;
        }>("SELECT result FROM world_build WHERE run_id=$1", [id])
      ).rows[0]?.result;
      if (initial)
        items.push({
          id: "initial",
          at: 0,
          summary: initial.report,
          continuation: null,
          counts: {
            nodes: initial.changes.nodes.length,
            edges: initial.changes.edges.length,
          },
        });
    }
    return AdminPage.parse({
      items,
      next:
        page.length && (after || rows.length >= 50) ? page.at(-1)!.id : null,
      previous:
        items.length && (after ? rows.length > 50 : !!before)
          ? (page[0]?.id ?? "0")
          : null,
    });
  }
  // 関係を読むだけで、観測・出来事・世界内の時点を変えない。モデルも呼ばない。
  async belongings(
    subject: string,
    id: string,
    actorId?: string,
  ): Promise<never> {
    await this.authorize(subject, id, "player", this.pool, actorId);
    throw new AccessError(
      409,
      "PLAY_API_CHANGED",
      "通常プレイは/api/worlds/:id/sessionと新しいCLIを利用してください。",
    );
  }
  // 運営者が世界ごとに有効にした場合だけ、いま出会えるフレンドと居場所を返す。
  async partners(
    subject: string,
    id: string,
    actorId?: string,
    before?: string,
  ) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      actorId,
    );
    if (!(await this.construction.get(id)).player_list)
      throw new AccessError(
        403,
        "PLAYER_LIST_DISABLED",
        "この世界ではプレイヤーの一覧を利用できません",
      );
    return this.botPlay.players(id, grant.actor_id!, before);
  }

  async knowledge(
    subject: string,
    id: string,
    before?: string,
    after?: string,
    actorId?: string,
  ) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      actorId,
    );
    const row = await this.construction.get(id),
      now = worldNow(row);
    let cursor: z.infer<typeof Cursor> | undefined;
    const raw = after || before;
    if (raw)
      try {
        cursor = Cursor.parse(
          JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
        );
      } catch {
        throw new AccessError(
          409,
          "CURSOR_INVALID",
          "履歴を再取得してください",
        );
      }
    const context = this.construction.agent.store.context(row.world_id!);
    const all = (
      await Promise.all([
        context.historyPage(
          grant.actor_id!,
          "see",
          now,
          after ? undefined : cursor,
          after ? cursor : undefined,
        ),
        context.historyPage(
          grant.actor_id!,
          "interpret",
          now,
          after ? undefined : cursor,
          after ? cursor : undefined,
        ),
      ])
    )
      .flat()
      .sort(
        (a, b) =>
          (after ? 1 : -1) *
          (a.period.from - b.period.from ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      );
    const edges = all.slice(0, 50);
    if (after) edges.reverse();
    const items = [],
      evidence: CharacterEvidence[] = [];
    for (const edge of edges) {
      if (edge.kind === "interpret" && edge.role !== "content") continue;
      const content =
        edge.kind === "interpret"
          ? await context.node(
              edge.target,
              Math.min(now, Math.max(0, (edge.period.until ?? now + 1) - 1)),
            )
          : undefined;
      items.push({
        id: edge.id,
        kind: edge.kind === "see" ? "observation" : "interpretation",
        text:
          edge.kind === "see"
            ? edge.text || edge.observation?.aspect || ""
            : (content?.text ?? ""),
        from: edge.period.from,
        ...(edge.period.until === undefined
          ? {}
          : { until: edge.period.until }),
      });
      evidence.push({
        ids:
          edge.kind === "see"
            ? [edge.target, ...(edge.observation?.sourceIds ?? [])]
            : [],
        text: items.at(-1)!.text,
      });
    }
    await context.validate();
    const encode = (edge: (typeof edges)[number] | undefined) =>
      edge
        ? Buffer.from(
            JSON.stringify({ from: edge.period.from, id: edge.id }),
          ).toString("base64url")
        : null;
    const characters = await this.players.characters(
      id,
      grant.actor_id!,
      evidence,
    );
    const page = KnowledgePage.parse({
      viewerId: grant.actor_id,
      at: now,
      items: items.map((item, index) => ({
        ...item,
        characters: characters[index],
      })),
      next: after || all.length > 50 ? encode(edges.at(-1)) : null,
      previous: (after ? all.length > 50 : !!before) ? encode(edges[0]) : null,
    });
    await recordInitialPresentation(
      this.pool,
      id,
      subject,
      page,
      new Map(edges.map((e) => [e.id, e.target])),
      this.construction.agent.store,
    );
    return page;
  }
  async reconcile(id: string) {
    const row = (
      await this.pool.query<{ world_id: string }>(
        "SELECT coalesce(c.world_id,b.world_id) AS world_id FROM world_construction c JOIN world_build b ON b.run_id=c.id WHERE c.id=$1",
        [id],
      )
    ).rows[0];
    if (!row) return;
    const store = this.construction.agent.store;
    for (const receipt of await store.pendingReceipts(row.world_id)) {
      const context = store.context(row.world_id),
        edges = [...receipt.changes.edges];
      for (const edgeId of receipt.changes.endEdges) {
        const edge = await context.edge(edgeId);
        if (edge) edges.push(edge);
      }
      const actors = new Set(
        edges
          .filter(
            (e) =>
              e.kind === "see" ||
              (e.kind === "interpret" && e.role === "content"),
          )
          .map((e) => e.source),
      );
      for (const node of receipt.changes.revisions.filter(
        (n) => n.kind === "script",
      ))
        for (const edge of await context.history(
          node.id,
          "interpret",
          "in",
          receipt.at,
        ))
          if (edge.role === "content") actors.add(edge.source);
      await context.validate();
      await this.pool.query(
        `INSERT INTO world_event(subject_id,construction_id,role,event_key)
         SELECT a.subject_id,a.construction_id,a.role,'commit:'||$2::text||':'||a.subject_id::text||':'||a.role||':'||a.construction_id::text
         FROM world_access a JOIN world_subject s ON s.id=a.subject_id
         WHERE a.construction_id=$1 AND s.active AND (a.role='admin' OR a.actor_id=ANY($3::uuid[]))
         ON CONFLICT(event_key) DO NOTHING`,
        [id, receipt.commitId, [...actors]],
      );
      await store.ackReceipt(row.world_id, receipt.commitId);
    }
  }

  async events(
    subject: string,
    id: string,
    role: Role,
    after: string,
    actorId?: string,
  ) {
    await this.authorize(subject, id, role, this.pool, actorId);
    if (!sequence(after))
      throw new AccessError(409, "CURSOR_INVALID", "進捗を再取得してください");
    if (after !== "0") {
      const cursor = await this.pool.query(
        "SELECT e.id FROM world_event e JOIN world_subject s ON s.id=e.subject_id WHERE e.id=$1 AND ($4='admin' OR (s.user_id=$2 AND s.active)) AND e.construction_id=$3 AND e.role=$4",
        [after, subject, id, role],
      );
      if (!cursor.rowCount)
        throw new AccessError(
          409,
          "CURSOR_INVALID",
          "進捗を再取得してください",
        );
    }
    await this.reconcile(id);
    return (
      await this.pool.query<{ id: string }>(
        "SELECT e.id::text FROM world_event e JOIN world_subject s ON s.id=e.subject_id WHERE ($3='admin' OR (s.user_id=$1 AND s.active)) AND e.construction_id=$2 AND e.role=$3 AND e.id>$4 ORDER BY e.id LIMIT 50",
        [subject, id, role, after],
      )
    ).rows;
  }
  async cursor(subject: string, id: string, role: Role, actorId?: string) {
    await this.authorize(subject, id, role, this.pool, actorId);
    await this.reconcile(id);
    return {
      cursor: (
        await this.pool.query<{ id: string }>(
          "SELECT coalesce(max(e.id),0)::text AS id FROM world_event e JOIN world_subject s ON s.id=e.subject_id WHERE ($3='admin' OR (s.user_id=$1 AND s.active)) AND e.construction_id=$2 AND e.role=$3",
          [subject, id, role],
        )
      ).rows[0]!.id,
    };
  }
}
