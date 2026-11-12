/**
 * Generates the PWA / push icons from ONE source image (default: client/public/favicon.png).
 *
 *   node scripts/generate-pwa-icons.mjs [source.png]
 *
 * The source is only resized and placed on the brand navy (#010C28); it is never
 * redrawn or recoloured. The Android notification badge must be a white
 * silhouette with transparency (Android masks it), so it is derived from the
 * source's bright mark. Re-run in Phase 4 with the official brand favicon.
 */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const src = path.resolve(process.argv[2] || "client/public/favicon.png");
const out = path.resolve("client/public/icons");
const NAVY = { r: 1, g: 12, b: 40, alpha: 1 }; // #010C28
fs.mkdirSync(out, { recursive: true });

const plain = (size, file) => sharp(src).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(out, file));

async function onNavy(size, scale, file) {
  const inner = Math.round(size * scale);
  const logo = await sharp(src).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: NAVY } })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(path.join(out, file));
}

async function badge(size, file) {
  // Alpha = brightness of the mark (the blue "P"), colour = white.
  const { data, info } = await sharp(src).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const b = data[i * 4 + 2], a = data[i * 4 + 3];
    const v = Math.max(0, Math.min(255, (b - 110) * 2.2)) * (a / 255);
    px[i * 4] = 255; px[i * 4 + 1] = 255; px[i * 4 + 2] = 255; px[i * 4 + 3] = Math.round(v);
  }
  await sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(path.join(out, file));
}

await plain(192, "icon-192.png");
await plain(512, "icon-512.png");
await onNavy(512, 0.8, "maskable-512.png");   // content inside the 80% safe zone
await onNavy(192, 0.8, "maskable-192.png");
await onNavy(180, 1, "apple-touch-icon.png");  // iOS: no transparency
await badge(96, "badge-96.png");
console.log("✔ icons written to client/public/icons");
