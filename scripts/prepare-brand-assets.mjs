/**
 * Builds the web copies of the official brand files (brand-assets/logos/*).
 *
 *   node scripts/prepare-brand-assets.mjs
 *
 * Originals are only RESIZED (aspect ratio kept, never stretched, recoloured or
 * redrawn). Outputs:
 *   client/public/brand/logo.png        full lockup (for light backgrounds)
 *   client/public/brand/icon.png        the "P" mark, transparent
 *   client/public/brand/emblem.png      square emblem
 *   client/public/favicon.ico / favicon.png   from the "P" mark
 *   client/public/icons/*               PWA + push icons from the emblem / mark
 */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve("brand-assets/logos");
const PUB = path.resolve("client/public");
const BRAND = path.join(PUB, "brand");
const ICONS = path.join(PUB, "icons");
fs.mkdirSync(BRAND, { recursive: true });
fs.mkdirSync(ICONS, { recursive: true });

const logo = path.join(SRC, "logo.png");
const mark = path.join(SRC, "icon.png");
const emblem = path.join(SRC, "emblem.png");
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
const NAVY = { r: 1, g: 12, b: 40, alpha: 1 }; // #010C28

// Brand web copies (fit inside, keep ratio).
await sharp(logo).resize({ width: 960, withoutEnlargement: true }).png({ compressionLevel: 9 }).toFile(path.join(BRAND, "logo.png"));
await sharp(mark).resize({ height: 256, withoutEnlargement: true }).png({ compressionLevel: 9 }).toFile(path.join(BRAND, "icon.png"));
await sharp(emblem).resize(512, 512).png({ compressionLevel: 9 }).toFile(path.join(BRAND, "emblem.png"));

// Square, transparent "P" mark (contain = padded, not stretched).
const squareMark = (size, pad = 0.06) => {
  const inner = Math.round(size * (1 - pad * 2));
  return sharp(mark).resize(inner, inner, { fit: "contain", background: CLEAR }).extend({
    top: Math.floor((size - inner) / 2), bottom: Math.ceil((size - inner) / 2),
    left: Math.floor((size - inner) / 2), right: Math.ceil((size - inner) / 2), background: CLEAR,
  }).png().toBuffer();
};

// favicon.png + favicon.ico (PNG-in-ICO: 16, 32, 48).
await fs.promises.writeFile(path.join(PUB, "favicon.png"), await squareMark(64));
const icoSizes = [16, 32, 48];
const pngs = await Promise.all(icoSizes.map((s) => squareMark(s, 0.02)));
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach((buf, i) => {
  const e = 6 + i * 16, s = icoSizes[i];
  header.writeUInt8(s, e); header.writeUInt8(s, e + 1); header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(buf.length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += buf.length;
});
await fs.promises.writeFile(path.join(PUB, "favicon.ico"), Buffer.concat([header, ...pngs]));

// PWA icons: the square emblem is the app icon (already full-bleed on navy).
await sharp(emblem).resize(192, 192).png().toFile(path.join(ICONS, "icon-192.png"));
await sharp(emblem).resize(512, 512).png().toFile(path.join(ICONS, "icon-512.png"));
await sharp(emblem).resize(180, 180).flatten({ background: NAVY }).png().toFile(path.join(ICONS, "apple-touch-icon.png"));
// Maskable: emblem scaled into the 80% safe zone on navy.
for (const size of [192, 512]) {
  const inner = await sharp(emblem).resize(Math.round(size * 0.8)).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: NAVY } })
    .composite([{ input: inner, gravity: "center" }]).png().toFile(path.join(ICONS, `maskable-${size}.png`));
}

// Android badge: white silhouette of the "P" mark (alpha = the mark's own alpha).
{
  const { data, info } = await sharp(await squareMark(96, 0.08)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = Buffer.alloc(info.width * info.height * 4, 255);
  for (let i = 0; i < info.width * info.height; i++) px[i * 4 + 3] = data[i * 4 + 3];
  await sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(path.join(ICONS, "badge-96.png"));
}

console.log("✔ brand assets + icons written");
