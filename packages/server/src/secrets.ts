import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
function key(master: string, domain: string) {
  if (!/^[a-f0-9]{64}$/.test(master))
    throw new Error(
      "運用設定を保護するOPERATIONS_TOKEN_SECRETを設定してください",
    );
  return createHmac("sha256", Buffer.from(master, "hex"))
    .update(domain)
    .digest();
}
export function seal(
  master: string,
  domain: string,
  label: string,
  value: string,
) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(master, domain), iv);
  cipher.setAAD(Buffer.from(label));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((p) => p.toString("base64"))
    .join(".");
}
export function unseal(
  master: string,
  domain: string,
  label: string,
  value: string,
) {
  const [iv, tag, body] = value.split(".").map((p) => Buffer.from(p, "base64")),
    decipher = createDecipheriv("aes-256-gcm", key(master, domain), iv!);
  decipher.setAAD(Buffer.from(label));
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(body!), decipher.final()]).toString(
    "utf8",
  );
}
