import { EventEmitter } from "node:events";
import type pg from "pg";

// Each API process shares one LISTEN connection. A lost DB connection closes its
// streams so clients subscribe again and read a fresh snapshot.
export class TurnSignals {
  private listening: Promise<pg.PoolClient> | undefined;
  private release: (() => void) | undefined;
  private readonly events = new EventEmitter().setMaxListeners(0);
  private async open(pool: pg.Pool) {
    const client = await pool.connect();
    let released = false;
    const lost = () => {
      if (released) return;
      released = true;
      this.listening = undefined;
      this.release = undefined;
      this.events.emit("lost");
      client.release(true);
    };
    this.release = lost;
    client.once("error", lost);
    client.once("end", lost);
    client.on("notification", (msg) => {
      if (msg.channel === "gestaloka_turn" && msg.payload)
        this.events.emit(msg.payload);
    });
    try {
      await client.query("LISTEN gestaloka_turn");
      return client;
    } catch (error) {
      lost();
      throw error;
    }
  }
  async subscribe(
    pool: pg.Pool,
    key: string,
    changed: () => void,
    close: () => void,
  ) {
    const pending = (this.listening ??= this.open(pool));
    try {
      await pending;
    } catch (e) {
      if (this.listening === pending) this.listening = undefined;
      throw e;
    }
    if (this.listening !== pending)
      throw new Error("手番の通知接続が切れました");
    this.events.on(key, changed).on("lost", close);
    return () => {
      this.events.off(key, changed).off("lost", close);
    };
  }
  async close() {
    await this.listening?.catch(() => undefined);
    this.release?.();
  }
}
