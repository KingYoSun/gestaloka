import type { SharedScenes } from "./shared-scenes.js";

export type ContactDecision = {
  listener: string;
  eventId: string;
  inputId: string;
  speaker: string;
  text: string;
  independent?: boolean;
};
export type ReceivedContact = {
  eventId: string;
  speaker: string;
  listener: string;
  at: number;
  text: string;
  replyInputId: string | null;
};

/** Stage a common execution; old opportunities are adapted at the reply boundary. */
export class PlayerContacts {
  constructor(readonly shared: SharedScenes) {}
  async setup() {
    await this.shared.pool
      .query(`CREATE TABLE IF NOT EXISTS world_player_contact (
      id uuid PRIMARY KEY,world_id uuid NOT NULL,source_scene uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,
      target_scene uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,speaker uuid NOT NULL,listener uuid NOT NULL,
      event_id uuid NOT NULL,input_id uuid NOT NULL,at bigint NOT NULL,text text NOT NULL,deadline timestamptz NOT NULL,
      state text NOT NULL DEFAULT 'pending',reply_id uuid UNIQUE,queued_text text,reply_kind text);
      CREATE INDEX IF NOT EXISTS world_contact_listener ON world_player_contact(target_scene,listener,at);
      CREATE INDEX IF NOT EXISTS world_contact_pending ON world_player_contact(world_id,listener) WHERE state='pending';
      CREATE INDEX IF NOT EXISTS world_contact_handoff_source ON world_player_contact(world_id,speaker) WHERE state='handoff';
      CREATE INDEX IF NOT EXISTS world_contact_handoff_listener ON world_player_contact(world_id,listener) WHERE state='handoff';`);
  }
}
