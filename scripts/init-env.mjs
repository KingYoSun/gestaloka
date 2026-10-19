import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

const postgresPassword = randomBytes(24).toString("base64url");
const graphPassword = randomBytes(24).toString("base64url");
const content = [
  `DATABASE_URL=postgresql://gestaloka:${postgresPassword}@127.0.0.1:25432/gestaloka`,
  `POSTGRES_PASSWORD=${postgresPassword}`,
  "NEO4J_URI=bolt://127.0.0.1:27687",
  "NEO4J_USER=neo4j",
  `NEO4J_PASSWORD=${graphPassword}`,
  "PORT=3000",
  "",
].join("\n");
try {
  await writeFile(new URL("../.env", import.meta.url), content, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    ".env を生成しました。既存のDB資格情報を変更する場合はDB側にも反映してください。",
  );
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("既存の .env を使用します。");
}
