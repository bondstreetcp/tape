// Map a ticker to its on-disk series filename. Windows reserves names like CON,
// PRN, AUX, NUL, COM1-9, LPT1-9 (even with an extension), so those get a "_"
// suffix. The same mapping must be used when writing and reading.
const RESERVED = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9]|CLOCK\$)$/i;

export function symbolFile(symbol: string): string {
  const s = symbol.toUpperCase();
  const dot = s.indexOf(".");
  const base = dot === -1 ? s : s.slice(0, dot);
  // Windows reserves CON, PRN, AUX… as device names — and "CON.DE" maps to the
  // console device too, because Windows looks at the segment before the FIRST dot.
  // So the "_" must suffix that segment (CON.DE → CON_.DE.json), not the whole
  // name (CON.DE_.json would still start with "CON."). Same map for read & write.
  if (RESERVED.test(base)) return base + "_" + (dot === -1 ? "" : s.slice(dot)) + ".json";
  return s + ".json";
}
