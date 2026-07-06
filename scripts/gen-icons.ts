/**
 * Generates the PWA / home-screen icons from an inline SVG chart mark → public/icons/*.png.
 * One-off asset generation (commit the output). Run: npx tsx scripts/gen-icons.ts
 * Needs `sharp` (already a dependency). No text in the art — sharp's SVG renderer has no fonts.
 */
import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";

const OUT = path.join(process.cwd(), "public", "icons");

// The "Tape" mark — the BREAKOUT TICK (chosen over the ticker-strip finalist): a price line bursting
// up and out of the ticker-tape band. Flat dark tile, emerald line. Text-free (sharp's SVG renderer
// has no fonts). Geometry is the approved 100-box lockup mark scaled ×5.12 to the 512 canvas.
const ART = `
  <rect x="46" y="317" width="420" height="123" rx="31" fill="#1a2330"/>
  <polyline points="102,379 174,348 230,369 297,266 358,215 420,159" fill="none" stroke="#34d68a" stroke-width="16.5" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="379,154 420,159 410,205" fill="none" stroke="#34d68a" stroke-width="16.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="102" cy="379" r="15" fill="#34d68a"/>`;
// Rounded-corner version for "any" purpose (transparent corners); full-bleed square for maskable +
// iOS — its art shrinks 85% toward center so the green gesture stays inside the circular safe zone.
const svg = (rounded: boolean) =>
  `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">` +
  (rounded
    ? `<rect width="512" height="512" rx="112" fill="#0d1117"/>${ART}`
    : `<rect width="512" height="512" fill="#0d1117"/><g transform="translate(38.4,38.4) scale(0.85)">${ART}</g>`) +
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
