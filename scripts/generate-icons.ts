import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// public/icon.svg（羊マスコットの静止版）から PWA / favicon 用の各サイズ PNG を生成する。
// icon.svg 自体を編集した場合は `bun run icons` で再生成し、生成物一式をコミットすること。

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = resolve(ROOT, "public");
const SVG_PATH = resolve(PUBLIC_DIR, "icon.svg");

const BG_COLOR = "#e7f3ec";
// SVG は 120x120 viewBox。ラスタライズ時の density を上げて縮小時のボケを防ぐ。
const RASTER_DENSITY = 384;

async function renderSheep(svg: Buffer, size: number): Promise<Buffer> {
  return sharp(svg, { density: RASTER_DENSITY }).resize(size, size).png().toBuffer();
}

async function generateTransparent(svg: Buffer, size: number, outPath: string): Promise<void> {
  const buffer = await renderSheep(svg, size);
  await writeFile(outPath, buffer);
}

async function generateOnBackground(
  svg: Buffer,
  canvasSize: number,
  sheepScale: number,
  outPath: string,
): Promise<void> {
  const sheepSize = Math.round(canvasSize * sheepScale);
  const sheep = await renderSheep(svg, sheepSize);
  const offset = Math.round((canvasSize - sheepSize) / 2);

  await sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: BG_COLOR,
    },
  })
    .composite([{ input: sheep, left: offset, top: offset }])
    .png()
    .toFile(outPath);
}

// 32x32 PNG を最小の ICO コンテナ（ヘッダ6byte + ディレクトリエントリ16byte）でラップする。
// モダンブラウザ/OS は ICO 内の PNG 埋め込みをサポートしている。
function wrapAsIco(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(1, 4); // image count

  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0); // width (0 は 256 の意。32 はそのまま入る)
  entry.writeUInt8(size, 1); // height
  entry.writeUInt8(0, 2); // palette colors (0 = パレットなし)
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8); // image data size
  entry.writeUInt32LE(header.length + entry.length, 12); // image data offset

  return Buffer.concat([header, entry, png]);
}

async function main(): Promise<void> {
  const svg = await readFile(SVG_PATH);

  await generateTransparent(svg, 192, resolve(PUBLIC_DIR, "icon-192.png"));
  await generateTransparent(svg, 512, resolve(PUBLIC_DIR, "icon-512.png"));
  await generateOnBackground(svg, 512, 0.8, resolve(PUBLIC_DIR, "icon-512-maskable.png"));
  await generateOnBackground(svg, 180, 0.88, resolve(PUBLIC_DIR, "apple-touch-icon.png"));

  const favicon32 = await renderSheep(svg, 32);
  await writeFile(resolve(PUBLIC_DIR, "favicon.ico"), wrapAsIco(favicon32, 32));

  console.log("icons generated in public/");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
