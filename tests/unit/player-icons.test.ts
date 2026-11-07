import sharp from "sharp";
import { expect, test } from "vitest";
import { playerIcon } from "../../packages/server/src/runtime/player-icons.js";
import { PLAYER_ICON_MAX_BYTES } from "@gestaloka/contracts";

const image = (width = 512, height = 256) =>
  sharp({ create: { width, height, channels: 3, background: "#c6922e" } });
test.each(["jpeg", "png", "webp"] as const)(
  "%sの実画素を検証し、縦横比を維持して付加情報を除去する",
  async (format) => {
    const bytes = await image()
      .withMetadata({ exif: { IFD0: { Artist: "not-public" } } })
      .toFormat(format)
      .toBuffer();
    const output = await playerIcon(bytes.toString("base64"));
    expect(output).toMatch(/^data:image\/webp;base64,/);
    const metadata = await sharp(
      Buffer.from(output.split(",")[1]!, "base64"),
    ).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 256, height: 128 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  },
);

test("小さい画像を引き伸ばさず、EXIFの向きを適用する", async () => {
  const bytes = await image(32, 16)
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const output = await playerIcon(bytes.toString("base64"));
  expect(
    await sharp(Buffer.from(output.split(",")[1]!, "base64")).metadata(),
  ).toMatchObject({ width: 16, height: 32 });
});

test("形式偽装・破損・容量超過・寸法超過・非対応形式を拒否する", async () => {
  const png = await image().png().toBuffer();
  for (const bytes of [
    Buffer.from("not-an-image"),
    png.subarray(0, 45),
    Buffer.alloc(PLAYER_ICON_MAX_BYTES + 1),
    await image(4097, 1).png().toBuffer(),
    await image().gif().toBuffer(),
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
    ),
  ])
    await expect(playerIcon(bytes.toString("base64"))).rejects.toMatchObject({
      code: "ICON_INVALID",
      status: 400,
    });
  await expect(playerIcon(png.toString("base64") + "!")).rejects.toMatchObject({
    code: "ICON_INVALID",
  });
});

test("WebPアニメーションとPNGのアニメーション制御チャンクを拒否する", async () => {
  const webp = await sharp({
    create: {
      width: 8,
      height: 16,
      pageHeight: 8,
      channels: 3,
      background: "black",
      noise: { type: "gaussian" },
    },
  })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  expect((await sharp(webp).metadata()).pages).toBe(2);
  await expect(playerIcon(webp.toString("base64"))).rejects.toMatchObject({
    code: "ICON_INVALID",
  });
  const png = await image(8, 8).png().toBuffer();
  // acTL is enough to distinguish APNG, even when the decoder only exposes its default frame.
  const animated = Buffer.concat([
    png.subarray(0, 33),
    Buffer.from("000000086163544c0000000200000000f38d9370", "hex"),
    png.subarray(33),
  ]);
  await expect(playerIcon(animated.toString("base64"))).rejects.toMatchObject({
    code: "ICON_INVALID",
  });
});
