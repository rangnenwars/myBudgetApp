import { compactInr, fitAmount, fitFontSize, GLYPH_WIDTH_EM, MIN_SCALE } from '../fitAmount';

describe('fitFontSize', () => {
  it('keeps the normal size while the width is unknown or the figure already fits', () => {
    expect(fitFontSize(20, 9, null)).toBe(20);
    expect(fitFontSize(20, 9, 0)).toBe(20);
    expect(fitFontSize(20, 5, 200)).toBe(20);
  });

  it('shrinks until the characters fit the width, never growing past the base', () => {
    const size = fitFontSize(20, 9, 100);
    expect(size).toBeLessThan(20);
    expect(9 * size * GLYPH_WIDTH_EM).toBeLessThanOrEqual(100);
    expect(fitFontSize(20, 1, 500)).toBe(20);
  });

  it('shrinks more for a longer figure in the same width', () => {
    expect(fitFontSize(20, 12, 100)).toBeLessThan(fitFontSize(20, 9, 100));
  });
});

describe('compactInr', () => {
  it('writes crores, lakhs and thousands the Indian way', () => {
    expect(compactInr(12345678)).toBe('₹1.2 Cr');
    expect(compactInr(100000000)).toBe('₹10 Cr');
    expect(compactInr(339668)).toBe('₹3.4 L');
    expect(compactInr(1250000)).toBe('₹12.5 L');
    expect(compactInr(45000)).toBe('₹45 K');
  });

  it('writes small amounts in full and keeps the sign', () => {
    expect(compactInr(8099)).toBe('₹8,099');
    expect(compactInr(0)).toBe('₹0');
    expect(compactInr(-8099)).toBe('-₹8,099');
    expect(compactInr(-12345678)).toBe('-₹1.2 Cr');
  });
});

describe('fitAmount', () => {
  it('shrinks a figure that is a little too wide', () => {
    const fit = fitAmount(20, 9, 100, true);
    expect(fit.useCompact).toBe(false);
    expect(fit.fontSize).toBeLessThan(20);
    expect(fit.fontSize).toBeGreaterThanOrEqual(20 * MIN_SCALE);
  });

  it('switches to the compact form when the full figure would be too small to read', () => {
    expect(fitAmount(20, 13, 90, true).useCompact).toBe(true);
  });

  it('never goes compact when the caller needs the exact figure, and still stays readable', () => {
    const fit = fitAmount(20, 13, 90, false);
    expect(fit.useCompact).toBe(false);
    expect(fit.fontSize).toBeGreaterThanOrEqual(10);
  });
});
