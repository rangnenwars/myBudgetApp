import { TOKENS, withAlpha } from '../../constants/theme';

// WCAG 2 relative luminance / contrast ratio.
const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe.each(['light', 'dark'] as const)('%s tokens', (scheme) => {
  const t = TOKENS[scheme];

  // Spec: "check 4.5:1 contrast for all body text".
  it.each(['ink', 'inkSoft', 'inkMuted', 'brand', 'positive', 'negative', 'warning', 'info', 'violet'] as const)(
    '%s text is at least 4.5:1 on bg and surface',
    (key) => {
      expect(contrast(t[key], t.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t[key], t.surface)).toBeGreaterThanOrEqual(4.5);
    }
  );

  it('on-brand text is at least 4.5:1 on brand and brandDeep', () => {
    expect(contrast(t.onBrand, t.brand)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.onBrand, t.brandDeep)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('withAlpha', () => {
  it('converts a hex colour to rgba', () => {
    expect(withAlpha('#0F5C4A', 0.5)).toBe('rgba(15, 92, 74, 0.5)');
  });
});
