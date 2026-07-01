/**
 * Generates the PWA / home-screen icons from an inline SVG chart mark → public/icons/*.png.
 * One-off asset generation (commit the output). Run: npx tsx scripts/gen-icons.ts
 * Needs `sharp` (already a dependency). No text in the art — sharp's SVG renderer has no fonts.
 */
import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";

const OUT = path.join(process.cwd(), "public", "icons");

// The "Tape" mark — a ticker TAPE: a cream paper strip with up/down quote ticks (green/red), plus
// two faint ghost strips behind it for the scrolling feel. Text-free (sharp's SVG renderer has no fonts).
const ART = `
  <rect x="72"  y="150" width="368" height="44" rx="12" fill="#ffffff" opacity="0.08"/>
  <rect x="72"  y="320" width="368" height="44" rx="12" fill="#ffffff" opacity="0.08"/>
  <rect x="60"  y="210" width="392" height="92" rx="16" fill="#eef2f8"/>
  <rect x="205" y="226" width="3"  height="60" rx="1.5" fill="#c7cfdb"/>
  <rect x="317" y="226" width="3"  height="60" rx="1.5" fill="#c7cfdb"/>
  <path d="M106,267 L130,267 L118,245 Z" fill="#16a34a"/>
  <rect x="140" y="248" width="52" height="16" rx="8" fill="#16a34a"/>
  <path d="M218,245 L242,245 L230,267 Z" fill="#dc2626"/>
  <rect x="252" y="248" width="52" height="16" rx="8" fill="#dc2626"/>
  <path d="M330,267 L354,267 L342,245 Z" fill="#16a34a"/>
  <rect x="364" y="248" width="52" height="16" rx="8" fill="#16a34a"/>`;
const GRAD = `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16233d"/><stop offset="1" stop-color="#0b0e14"/></linearGradient>`;
// Rounded-corner version for "any" purpose (transparent corners); full-bleed square for maskable + iOS.
const svg = (rounded: boolean) =>
  `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><defs>${GRAD}</defs>` +
  (rounded ? `<rect width="512" height="512" rx="112" fill="url(#bg)"/>` : `<rect width="512" height="512" fill="url(#bg)"/>`) +
  ART +
  `</svg>`;

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const rounded = Buffer.from(svg(true));
  const square = Buffer.from(svg(false));
  const jobs: [Buffer, number, string][] = [
    [rounded, 192, "icon-192.png"],
    [rounded, 512, "icon-512.png"],
    [square, 512, "icon-maskable-512.png"],
    [square, 192, "icon-maskable-192.png"],
    [square, 180, "apple-touch-icon.png"],
    [rounded, 32, "favicon-32.png"],
    [rounded, 16, "favicon-16.png"],
  ];
  for (const [buf, size, name] of jobs) {
    await sharp(buf).resize(size, size).png().toFile(path.join(OUT, name));
    console.log(`  wrote icons/${name} (${size}×${size})`);
  }
  await fs.writeFile(path.join(OUT, "icon.svg"), svg(true));
  console.log("  wrote icons/icon.svg");
}
main().catch((e) => { console.error(e); process.exit(1); });
