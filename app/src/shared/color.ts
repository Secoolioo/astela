/** A color in OKLCH: lightness 0-1, chroma and hue in degrees. */
export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

/** Linear sRGB components, 0-1 inside the gamut. */
type Rgb = readonly [number, number, number];

/**
 * The WCAG contrast ratio of two OKLCH colors.
 * @param a - One color.
 * @param b - The other color.
 * @returns A ratio from 1 to 21.
 */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const [la, lb] = [luminance(toRgb(a)), luminance(toRgb(b))];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * A contrast ratio as people read it in a language, with one decimal, such as `4.5` in
 * English and `4,5` in German.
 * @param ratio - The contrast ratio.
 * @param language - The language of the text, such as `de`.
 */
export function formatRatio(ratio: number, language: string | undefined): string {
  return new Intl.NumberFormat(language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ratio);
}

/**
 * Reads a `#rrggbb` color.
 * @param hex - The color; anything else reads as black.
 */
export function oklchFromHex(hex: string): Oklch {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  const channel = (index: number): number => toLinear(parseInt(match?.[index] ?? '00', 16) / 255);
  const [r, g, b] = [channel(1), channel(2), channel(3)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lab = {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
  const hue = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  return { l: lab.l, c: Math.hypot(lab.a, lab.b), h: hue < 0 ? hue + 360 : hue };
}

/** Lowers the chroma until the color fits into sRGB. */
export function inGamut(color: Oklch): Oklch {
  const fits = (c: number): boolean =>
    toRgb({ ...color, c }).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  if (fits(color.c)) {
    return color;
  }
  let [low, high] = [0, color.c];
  for (let i = 0; i < 30; i += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return { ...color, c: low };
}

function toRgb({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1,
    -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1,
    -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1,
  ];
}

function toLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance as WCAG defines it, from linear sRGB clamped to the gamut. */
function luminance([r, g, b]: Rgb): number {
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Writes a color as CSS. */
export function css({ l, c, h }: Oklch): string {
  return `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(3)} ${h.toFixed(1)})`;
}

/**
 * Writes a color as `#rrggbb`, within the sRGB gamut.
 * @param color - The color.
 */
export function hexFromOklch(color: Oklch): string {
  const [r, g, b] = toRgb(inGamut(color));
  return `#${encode(r)}${encode(g)}${encode(b)}`;
}

/**
 * Reads a color as the design tokens write it: `#rrggbb` or `oklch(L% C H)`.
 * @param value - The color.
 * @returns The color, or `undefined` for anything else.
 */
export function parseColor(value: string): Oklch | undefined {
  if (/^#[0-9a-f]{6}$/i.test(value)) return oklchFromHex(value);
  const match = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/i.exec(value);
  if (match === null) return undefined;
  return { l: Number(match[1]) / 100, c: Number(match[2]), h: Number(match[3]) };
}

/** A linear sRGB component as two hexadecimal digits. */
function encode(value: number): string {
  const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(clamp(encoded) * 255)
    .toString(16)
    .padStart(2, '0');
}
