import type { paths } from "@gestaloka/contracts/http";
import type { Command } from "./admin-catalog.js";
import { api } from "./api.js";
export async function operate(
  command: Command,
  requestId: string = crypto.randomUUID(),
  signal?: AbortSignal,
) {
  type WireCommand =
    paths["/api/operations"]["post"]["requestBody"]["content"]["application/json"]["command"];
  const data = (
    await api.POST("/api/operations", {
      body: { requestId, command: command as WireCommand },
      ...(signal ? { signal } : {}),
    })
  ).data;
  if (!data) throw new Error("受付結果を取得できませんでした");
  return data.result;
}
