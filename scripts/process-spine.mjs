import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const SRC = path.join(root, "public/machine-agent/spine-source.png");
const OUT = path.join(root, "public/images/machine-agent/spine.jpg");

const meta = await sharp(SRC).metadata();
const srcW = meta.width;
const srcH = meta.height;

const targetRatio = 3 / 4;
const ZOOM = 1.55;
const cropH = Math.round(srcH / ZOOM);
const cropW = Math.round(cropH * targetRatio);
// Source has its spine column ~1.5% right of geometric center; nudge crop
// window right so the spine lands dead-center in output.
const SPINE_X_OFFSET_PX = 34;
const cropLeft = Math.floor((srcW - cropW) / 2) + SPINE_X_OFFSET_PX;
const cropTop = Math.floor((srcH - cropH) / 2);

const cropped = await sharp(SRC)
  .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
  .toBuffer();

const cropMeta = await sharp(cropped).metadata();
console.log("cropped:", cropMeta.width, "x", cropMeta.height);

const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cropMeta.width}" height="${cropMeta.height}">
  <defs>
    <radialGradient id="vignette" cx="50%" cy="50%" r="65%">
      <stop offset="0%" stop-color="#000" stop-opacity="0.45"/>
      <stop offset="40%" stop-color="#000" stop-opacity="0.15"/>
      <stop offset="75%" stop-color="#000" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.55"/>
    </radialGradient>
    <linearGradient id="leftEdge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#000" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="rightEdge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${Math.round(cropMeta.width * 0.18)}" height="${cropMeta.height}" fill="url(#leftEdge)"/>
  <rect x="${cropMeta.width - Math.round(cropMeta.width * 0.18)}" y="0" width="${Math.round(cropMeta.width * 0.18)}" height="${cropMeta.height}" fill="url(#rightEdge)"/>
  <rect x="0" y="0" width="${cropMeta.width}" height="${cropMeta.height}" fill="url(#vignette)"/>
</svg>`;

const overlayPng = await sharp(Buffer.from(overlaySvg))
  .resize(cropMeta.width, cropMeta.height, { fit: "fill" })
  .png()
  .toBuffer();

const composited = await sharp(cropped)
  .composite([{ input: overlayPng, blend: "over" }])
  .png()
  .toBuffer();

await sharp(composited)
  .jpeg({ quality: 95, mozjpeg: false, chromaSubsampling: "4:4:4" })
  .toFile(OUT);

const outMeta = await sharp(OUT).metadata();
console.log("output:", OUT);
console.log("size:", outMeta.width, "x", outMeta.height, "format:", outMeta.format);
