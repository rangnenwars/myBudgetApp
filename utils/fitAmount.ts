// Sizing for money figures that must stay on one line (components/AmountText.tsx).
// Pure, so the maths is unit-tested without rendering anything.

/** Average width of a bold digit/comma/₹ glyph, as a fraction of the font size. Browser fonts measure about 0.5; the phone's Roboto is a little wider, so this stays generous enough that a figure never gets cut off. */
export const GLYPH_WIDTH_EM = 0.6;

/** How small a figure may shrink, as a fraction of its normal size, before it is shown in compact form instead. */
export const MIN_SCALE = 0.7;

/** The font size at which `chars` characters fit in `width` pixels, never above `base`. Returns `base` while the width is still unknown. */
export const fitFontSize = (base: number, chars: number, width: number | null): number => {
  if (width == null || width <= 0 || chars <= 0) return base;
  const fitted = width / (chars * GLYPH_WIDTH_EM);
  return Math.min(base, Math.floor(fitted * 10) / 10);
};

/** Indian-style compact form of a rupee amount: ₹1.2 Cr, ₹12.3 L, ₹45 K; smaller amounts are written out in full. Keeps the sign. */
export const compactInr = (n: number): string => {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const trim = (x: number) => String(Math.round(x * 10) / 10);
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)} L`;
  if (abs >= 1e4) return `${sign}₹${trim(abs / 1e3)} K`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
};

export interface Fit {
  fontSize: number;
  /** True when the full figure would have to shrink below MIN_SCALE, so the compact form should be shown instead. */
  useCompact: boolean;
}

/** Decides the size (and whether to fall back to the compact form) for a figure of `chars` characters in `width` pixels. */
export const fitAmount = (base: number, chars: number, width: number | null, canCompact: boolean): Fit => {
  const size = fitFontSize(base, chars, width);
  if (canCompact && size < base * MIN_SCALE) return { fontSize: base, useCompact: true };
  return { fontSize: Math.max(size, Math.min(base, Math.ceil(base * 0.5))), useCompact: false };
};
