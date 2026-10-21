import { AccessError } from "../http/access.js";

/** The controller survives replacement of the application database. */
export class Backups {
  constructor(
    readonly url = process.env.BACKUP_CONTROLLER_URL,
    readonly token = process.env.BACKUP_CONTROLLER_TOKEN,
    readonly transport: typeof fetch = fetch,
  ) {}
  async call(action: string, body: unknown = {}) {
    if (!this.url || !this.token)
      throw new AccessError(
        503,
        "BACKUPS_NOT_CONFIGURED",
        "バックアップの制御サービスを設定してください",
      );
    let response: Response;
    try {
      response = await this.transport(`${this.url}/${action}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new AccessError(
        503,
        "BACKUPS_UNAVAILABLE",
        "バックアップの制御サービスに接続できません",
      );
    }
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok)
      throw new AccessError(
        409,
        "BACKUP_CONFLICT",
        "バックアップの設定・実行状態を確認してください",
      );
    return data;
  }
}
