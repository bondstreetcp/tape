// Map a ticker to its on-disk series filename. Windows reserves names like CON,
// PRN, AUX, NUL, COM1-9, LPT1-9 (even with an extension), so those get a "_"
// suffix. The same mapping must be used when writing and reading.
const RESERVED = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9]|CLOCK\$)$/i;

export function symbolFile(symbol: string): string {
  const s = symbol.toUpperCase();
  return (RESERVED.test(s) ? `${s}_` : s) + ".json";
}
