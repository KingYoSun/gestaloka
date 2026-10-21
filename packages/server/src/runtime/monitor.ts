import { randomUUID } from "node:crypto";
import type pg from "pg";
import { RuntimeSettings } from "@gestaloka/contracts";
import type { z } from "zod";
import { unseal } from "../secrets.js";
import { RuntimeExecutions } from "./executions.js";

type Metrics = Record<
  keyof z.infer<typeof RuntimeSettings>["thresholds"],
  number | null
>;
type Settings = {
  version: number;
  configuration: z.infer<typeof RuntimeSettings>;
  webhookVersion: number;
  url: string | null;
};
type Event = {
  eventId: string;
  at: string;
  type: "alert" | "recovery";
  metric: string;
  value: number;
  threshold: number;
  configurationVersion: number;
  webhookVersion: number;
  deliveredAt?: string;
  status: "pending" | "delivered";
};
type Sample = {
  sampleId: string;
  at: string;
  metrics: Metrics;
  settings: Settings;
  alerts: string[];
  events: Event[];
};
async function probe<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("monitor timeout")), 5000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
const domain = "gestaloka.monitor-webhook.v1";
export class RuntimeMonitor {
  #settings?: Settings;
  #alerts: string[] = [];
  #channel = 0;
  #owner = false;
  #buffer: Sample[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #current: Promise<unknown> | undefined;
  #stopped = false;
  constructor(
    readonly pool: pg.Pool,
    readonly graph: { verifyConnectivity: () => Promise<unknown> },
    readonly master: string,
    readonly transport: typeof fetch = fetch,
  ) {}
  static async setup(db: Pick<pg.Pool, "query">) {
    await db.query(`CREATE TABLE IF NOT EXISTS monitor_state(singleton boolean PRIMARY KEY CHECK(singleton),claim uuid,
      lease_until timestamptz NOT NULL DEFAULT '-infinity',last_at timestamptz,alerts jsonb NOT NULL DEFAULT '[]',webhook_version integer NOT NULL DEFAULT 0);
      INSERT INTO monitor_state(singleton) VALUES(true) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS monitor_sample(id bigserial PRIMARY KEY,sample_id uuid UNIQUE NOT NULL,at timestamptz NOT NULL,
      configuration_version integer NOT NULL,metrics jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS monitor_notification(id bigserial PRIMARY KEY,event_id uuid UNIQUE NOT NULL,at timestamptz NOT NULL,
      payload jsonb NOT NULL,webhook_version integer NOT NULL,status text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,
      next_at timestamptz NOT NULL DEFAULT now(),claim uuid,lease_until timestamptz NOT NULL DEFAULT '-infinity',delivered_at timestamptz,error_code text);
      CREATE INDEX IF NOT EXISTS monitor_notification_due ON monitor_notification(status,next_at);`);
  }
  static async page(
    db: Pick<pg.Pool, "query">,
    kind: "samples" | "notifications",
    before?: string,
  ) {
    const rows = (
      await db.query(
        kind === "samples"
          ? `SELECT id::text,at,configuration_version AS "configurationVersion",metrics FROM monitor_sample WHERE ($1::bigint IS NULL OR id<$1) ORDER BY monitor_sample.id DESC LIMIT 51`
          : `SELECT id::text,event_id AS "eventId",at,payload,status,attempts,delivered_at AS "deliveredAt",error_code AS "errorCode" FROM monitor_notification WHERE ($1::bigint IS NULL OR id<$1) ORDER BY monitor_notification.id DESC LIMIT 51`,
        [before ?? null],
      )
    ).rows;
    return {
      items: rows.slice(0, 50).map((r) => ({
        ...r,
        at: r.at.toISOString(),
        ...(kind === "notifications"
          ? { deliveredAt: r.deliveredAt?.toISOString() ?? null }
          : {}),
      })),
      next: rows.length > 50 ? rows[49].id : null,
    };
  }
  async #load() {
    const r = (
      await this.pool.query(
        "SELECT version,configuration,webhook_version,webhook_cipher FROM runtime_control WHERE singleton",
      )
    ).rows[0];
    this.#settings = {
      version: r.version,
      configuration: RuntimeSettings.parse(r.configuration),
      webhookVersion: r.webhook_version,
      url: r.webhook_cipher
        ? unseal(this.master, domain, "url", r.webhook_cipher)
        : null,
    };
    return this.#settings;
  }
  async #measure(): Promise<Metrics> {
    const seconds = this.#settings!.configuration.sampleIntervalSeconds;
    const [pgResult, graphResult] = await Promise.allSettled([
      probe(
        this.pool.query(
          `SELECT pg_database_size(current_database())::float8 AS bytes,
        (SELECT count(*)::float8/current_setting('max_connections')::int*100 FROM pg_stat_activity WHERE backend_type='client backend') AS connections,
        (SELECT coalesce(sum(charged_nano),0)::float8/1e9 FROM llm_call WHERE state='complete') AS calculated,
        (SELECT coalesce(sum(reserved_nano),0)::float8/1e9 FROM llm_call WHERE state<>'complete') AS unsettled,
        (SELECT sum(failed)::float8/nullif(sum(completed),0)*100 FROM runtime_metric WHERE at>=date_trunc('minute',now()-$1*interval '1 second')) AS errors,
        greatest((SELECT max(latency_ms) FROM runtime_metric WHERE at>=date_trunc('minute',now()-$1*interval '1 second')),
          (SELECT max(extract(epoch FROM now()-started_at)*1000) FROM runtime_execution WHERE state='running'))::float8 AS latency,
        (SELECT max(extract(epoch FROM now()-created_on))::float8 FROM pgboss.job j WHERE state IN ('created','retry') AND
          (EXISTS(SELECT 1 FROM world_construction c WHERE c.id::text=j.data->>'id') OR EXISTS(SELECT 1 FROM world_scene s WHERE s.id::text=j.data->>'id') OR EXISTS(SELECT 1 FROM world_join p WHERE p.id::text=j.data->>'id'))) AS queue`,
          [seconds],
        ),
      ),
      probe(this.graph.verifyConnectivity()),
    ]);
    const r =
      pgResult.status === "fulfilled" ? pgResult.value.rows[0] : undefined;
    return {
      postgresUnavailable: r ? 0 : 1,
      graphUnavailable: graphResult.status === "fulfilled" ? 0 : 1,
      postgresBytes: r?.bytes ?? null,
      postgresConnectionPercent: r?.connections ?? null,
      calculatedUsd: r?.calculated ?? null,
      unsettledUsd: r?.unsettled ?? null,
      errorPercent: r?.errors ?? null,
      latencyMs: r?.latency ?? null,
      queueAgeSeconds: r?.queue ?? (r ? 0 : null),
    };
  }
  #sample(metrics: Metrics): Sample {
    const settings = this.#settings!,
      alerts: string[] = [],
      events: Event[] = [],
      at = new Date().toISOString();
    for (const [metric, threshold] of Object.entries(
      settings.configuration.thresholds,
    )) {
      const value = metrics[metric as keyof Metrics],
        was = this.#alerts.includes(metric);
      const active = value === null ? was : value > threshold;
      if (active) alerts.push(metric);
      if (
        settings.url &&
        value !== null &&
        (active !== was ||
          (active && this.#channel !== settings.webhookVersion))
      )
        events.push({
          eventId: randomUUID(),
          at,
          type: active ? "alert" : "recovery",
          metric,
          value,
          threshold,
          configurationVersion: settings.version,
          webhookVersion: settings.webhookVersion,
          status: "pending",
        });
    }
    this.#alerts = alerts;
    this.#channel = settings.webhookVersion;
    return { sampleId: randomUUID(), at, metrics, settings, alerts, events };
  }
  async #save(sample: Sample, claim?: string) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const state = (
        await db.query(
          "SELECT claim FROM monitor_state WHERE singleton FOR UPDATE",
        )
      ).rows[0];
      if (claim && state.claim !== claim) {
        await db.query("ROLLBACK");
        return;
      }
      await db.query(
        "INSERT INTO monitor_sample(sample_id,at,configuration_version,metrics) VALUES($1,$2,$3,$4) ON CONFLICT(sample_id) DO NOTHING",
        [sample.sampleId, sample.at, sample.settings.version, sample.metrics],
      );
      for (const e of sample.events) {
        const { status, deliveredAt, ...payload } = e;
        await db.query(
          `INSERT INTO monitor_notification(event_id,at,payload,webhook_version,status,delivered_at) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(event_id) DO UPDATE SET status=CASE WHEN excluded.status='delivered' THEN 'delivered' ELSE monitor_notification.status END,delivered_at=coalesce(monitor_notification.delivered_at,excluded.delivered_at)`,
          [
            e.eventId,
            e.at,
            payload,
            e.webhookVersion,
            status,
            deliveredAt ?? null,
          ],
        );
      }
      await db.query(
        "UPDATE monitor_state SET last_at=$1,alerts=$2,webhook_version=$3,lease_until=now() WHERE singleton AND (last_at IS NULL OR last_at<=$1)",
        [
          sample.at,
          JSON.stringify(sample.alerts),
          sample.settings.webhookVersion,
        ],
      );
      await db.query(
        `WITH old_samples AS (DELETE FROM monitor_sample WHERE at<now()-$1*interval '1 day'), old_notifications AS (DELETE FROM monitor_notification WHERE at<now()-$1*interval '1 day') DELETE FROM runtime_metric WHERE at<now()-$1*interval '1 day'`,
        [sample.settings.configuration.retentionDays],
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async #send(url: string, e: Event) {
    try {
      const { status: _, ...payload } = e;
      void _;
      const r = await this.transport(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Gestaloka-Notification-Id": e.eventId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      return r.ok ? null : `HTTP_${r.status}`;
    } catch {
      return "NETWORK_ERROR";
    }
  }
  async #deliver() {
    for (let n = 0; n < 50; n++) {
      const claim = randomUUID(),
        r = (
          await this.pool.query(
            `UPDATE monitor_notification n SET claim=$1,lease_until=now()+interval '30 seconds',attempts=attempts+1
        FROM runtime_control c WHERE c.singleton AND n.id=(SELECT id FROM monitor_notification WHERE status='pending' AND webhook_version=c.webhook_version AND next_at<=now() AND lease_until<now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING n.*,c.webhook_cipher,c.configuration`,
            [claim],
          )
        ).rows[0];
      if (!r || !r.webhook_cipher) break;
      const error = await this.#send(
        unseal(this.master, domain, "url", r.webhook_cipher),
        r.payload,
      );
      await this.pool.query(
        "UPDATE monitor_notification SET status=$3,error_code=$4,delivered_at=CASE WHEN $3='delivered' THEN now() ELSE NULL END,lease_until=now(),next_at=now()+$5*interval '1 second' WHERE id=$1 AND claim=$2",
        [
          r.id,
          claim,
          error ? "pending" : "delivered",
          error,
          r.configuration.sampleIntervalSeconds,
        ],
      );
    }
  }
  async sample(force = false) {
    let sample: Sample | undefined;
    try {
      const settings = await this.#load();
      for (const buffered of this.#buffer) await this.#save(buffered);
      this.#buffer = [];
      await RuntimeExecutions.reconcile(this.pool);
      const claim = randomUUID(),
        state = (
          await this.pool.query(
            `UPDATE monitor_state SET claim=$1,lease_until=now()+interval '30 seconds' WHERE singleton AND lease_until<now()
        AND ($2::boolean OR last_at IS NULL OR last_at<=now()-$3*interval '1 second') RETURNING alerts,webhook_version`,
            [claim, force, settings.configuration.sampleIntervalSeconds],
          )
        ).rows[0];
      this.#owner = !!state;
      if (state) {
        this.#alerts = state.alerts;
        this.#channel = state.webhook_version;
        sample = this.#sample(await this.#measure());
        await this.#save(sample, claim);
      }
      await this.pool.query(
        "UPDATE monitor_notification SET status='superseded' WHERE status='pending' AND webhook_version<>(SELECT webhook_version FROM runtime_control WHERE singleton)",
      );
      await this.#deliver();
      return { sampled: !!sample, metrics: sample?.metrics ?? null };
    } catch {
      if (!this.#settings || !this.#owner)
        return { sampled: false, metrics: null };
      sample ??= this.#sample({
        postgresUnavailable: 1,
        graphUnavailable: await probe(this.graph.verifyConnectivity()).then(
          () => 0,
          () => 1,
        ),
        postgresBytes: null,
        postgresConnectionPercent: null,
        calculatedUsd: null,
        unsettledUsd: null,
        errorPercent: null,
        latencyMs: null,
        queueAgeSeconds: null,
      });
      this.#buffer.push(sample);
      this.#buffer = this.#buffer.filter(
        (s) =>
          Date.parse(s.at) >=
          Date.now() - this.#settings!.configuration.retentionDays * 86400000,
      );
      for (const e of sample.events)
        if (
          this.#settings.url &&
          (await this.#send(this.#settings.url, e)) === null
        ) {
          e.status = "delivered";
          e.deliveredAt = new Date().toISOString();
        }
      return { sampled: true, metrics: sample.metrics };
    }
  }
  start() {
    this.#stopped = false;
    const next = () => {
      if (this.#stopped) return;
      this.#current = this.sample().finally(() => {
        if (!this.#stopped) {
          this.#timer = setTimeout(
            next,
            (this.#settings?.configuration.sampleIntervalSeconds ?? 60) * 1000,
          );
          this.#timer.unref();
        }
      });
    };
    next();
  }
  async stop() {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    await this.#current;
  }
}
