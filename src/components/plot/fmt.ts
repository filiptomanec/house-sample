// Number helpers of the Plot page on top of the locale formatter (never toFixed / toLocaleString on screen).
import { MINUS, NBSP, type Formatter } from "@/lib/i18n/format";

/** Height with a sign and a real minus: +0,35, −0,90, ±0,00 (a value that rounds to zero is neither plus nor minus). */
export function signed(f: Formatter, v: number, digits = 2): string {
  const txt = f.num(Math.abs(v), digits);
  if (!/[1-9]/.test(txt)) return `±${txt}`;
  return `${v > 0 ? "+" : MINUS}${txt}`;
}

/** Height above sea level with its unit written by the dictionary: "240,35". */
export const absolute = (f: Formatter, relative: number, zeroLevelAsl: number, digits = 2): string => f.num(zeroLevelAsl + relative, digits);

/** Compass bearing as degrees, 0 to 359. */
export const bearing = (f: Formatter, deg: number): string => f.degrees(((Math.round(deg) % 360) + 360) % 360);

export { NBSP };
