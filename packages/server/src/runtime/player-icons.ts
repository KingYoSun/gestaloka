import sharp from "sharp";
import { PLAYER_ICON_MAX_BYTES } from "@gestaloka/contracts";
import { AccessError } from "../http/access.js";

export async function playerIcon(image: string) {
  try {
    const bytes = Buffer.from(image, "base64");
    if (
      !bytes.length ||
      bytes.length > PLAYER_ICON_MAX_BYTES ||
      bytes.toString("base64") !== image
    )
      throw new Error();
    const input = sharp(bytes, {
      limitInputPixels: 4096 * 4096,
      failOn: "warning",
    });
    const metadata = await input.metadata();
    if (
      !metadata.format ||
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      !metadata.width ||
      !metadata.height ||
      Math.max(metadata.width, metadata.height) > 4096 ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error();
    // libvips can read APNG as a single PNG frame. Reject its animation control chunk too.
    if (metadata.format === "png") {
      for (let offset = 8; offset + 12 <= bytes.length;) {
        if (bytes.toString("ascii", offset + 4, offset + 8) === "acTL")
          throw new Error();
        offset += bytes.readUInt32BE(offset) + 12;
      }
    }
    const output = await input
      .rotate()
      .resize(256, 256, { fit: "inside", withoutEnlargement: true })
      .webp()
      .toBuffer();
    return `data:image/webp;base64,${output.toString("base64")}`;
  } catch {
    throw new AccessError(
      400,
      "ICON_INVALID",
      "JPEG・PNG・WebPの静止画を指定してください（5MiB以下、長辺4096px以下）",
    );
  }
}
