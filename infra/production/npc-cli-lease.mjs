import { createConnection } from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function npcWakeLease(directory, npc, turn, receive = false) {
  const enabled = await readFile(
    new URL("bridge/" + npc, directory),
    "utf8",
  ).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return "";
  });
  if (enabled.trim() !== "enabled") return {};
  const lease = await new Promise((resolve, reject) => {
    const socket = createConnection(
      fileURLToPath(new URL("profiles/.npc-cli.sock", directory)),
    );
    socket.setEncoding("utf8");
    socket.setTimeout(2500, () =>
      socket.destroy(new Error("NPC_CLI_BRIDGE_TIMEOUT")),
    );
    socket.on("error", reject);
    socket.on("connect", () =>
      socket.write(JSON.stringify({ npc, turn, receive }) + "\n"),
    );
    let result = "";
    socket.on("data", (chunk) => {
      result += chunk;
      if (result.length > 64)
        socket.destroy(new Error("NPC_CLI_LEASE_INVALID"));
    });
    socket.on("end", () => {
      const token = result.trim();
      if (/^[a-zA-Z0-9_-]{43}$/.test(token)) resolve(token);
      else reject(new Error("NPC_CLI_LEASE_INVALID"));
    });
  });
  return { npc, lease };
}
