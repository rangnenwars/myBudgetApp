import { Platform } from 'react-native';

// react-native-web's Modal "slide" animation can get stuck fully off-screen
// (the enter transform never resolves), so web falls back to a plain fade.
export const MODAL_ANIMATION: 'slide' | 'fade' = Platform.OS === 'web' ? 'fade' : 'slide';

// ============================================================
// Prapanji design tokens (docs/PRAPANJI_SPEC.md → "Design system").
// Calm ledger green, warm off-white paper, one saffron accent used sparingly.
// ============================================================
export type ThemeTokens = {
  brand: string; // primary buttons, header band, active tab
  brandDeep: string; // pressed states, links on hover
  onBrand: string; // text/icons on a brand fill
  accent: string; // highlights, streak flame — one per screen max
  bg: string; // screen background
  surface: string; // cards, inputs, sheets
  ink: string; // primary text
  inkSoft: string; // body copy
  inkMuted: string; // captions, hints
  line: string; // input borders, dividers
  positive: string; // you are owed, income, under budget
  negative: string; // you owe, over budget
  warning: string; // 80–100% of budget
  info: string; // secondary data series (charts)
  violet: string; // tertiary data series (charts)
  backdrop: string; // modal scrim
  frame: string; // web: area outside the phone-width column
};

export const TOKENS: Record<'light' | 'dark', ThemeTokens> = {
  light: {
    brand: '#0F5C4A',
    brandDeep: '#0A3F33',
    onBrand: '#FFFFFF',
    accent: '#E8892B',
    bg: '#F5F6F2',
    surface: '#FFFFFF',
    ink: '#14251F',
    inkSoft: '#44544E',
    inkMuted: '#5A6862',
    line: '#C9D1CB',
    positive: '#1B7F4E',
    negative: '#B3261E',
    warning: '#A35A00',
    info: '#2A62A8',
    violet: '#6A4BB0',
    backdrop: 'rgba(20, 37, 31, 0.45)',
    frame: '#E4E8E1',
  },
  dark: {
    brand: '#3FA98C',
    brandDeep: '#2C8A71',
    // White on #3FA98C is under 3:1, so dark mode puts dark ink on the brand fill.
    onBrand: '#030806',
    accent: '#F0A050',
    bg: '#0E1714',
    surface: '#16221E',
    ink: '#E8EEEA',
    inkSoft: '#A9B7B1',
    inkMuted: '#8A9993',
    line: '#2A3833',
    positive: '#4CC38A',
    negative: '#F2857D',
    warning: '#F0B860',
    info: '#7DB3F0',
    violet: '#B9A4F0',
    backdrop: 'rgba(0, 0, 0, 0.6)',
    frame: '#08100D',
  },
};

// The app always uses the light theme (the approved login prototype),
// whatever the phone or browser is set to. The dark tokens above are kept
// for a later opt-in dark mode.
export const SCHEME: 'light' | 'dark' = 'light';
export const T: ThemeTokens = TOKENS[SCHEME];

// Legacy names used across the screens, mapped onto the tokens above.
export const COLORS = {
  bg: T.bg,
  card: T.surface,
  cardBorder: T.line,
  input: T.surface,
  adminBg: T.bg,
  accent: T.brand,
  accentDim: T.brandDeep,
  onAccent: T.onBrand,
  positive: T.positive,
  red: T.negative,
  yellow: T.warning,
  blue: T.info,
  purple: T.violet,
  adminRed: T.negative,
  proGold: T.accent,
  text: T.ink,
  textMuted: T.inkSoft,
  textDim: T.inkMuted,
  backdrop: T.backdrop,
};

/** `#RRGGBB` → `rgba(r, g, b, opacity)`, for chart colour callbacks. */
export const withAlpha = (hex: string, opacity: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
};

const CLASS_COLOR_SETS: Record<'light' | 'dark', Record<string, string>> = {
  light: { low: '#2A62A8', middle: '#1B7F4E', high: '#A35A00', ultra_high: '#B4481B', rich: '#6A4BB0' },
  dark: { low: '#7DB3F0', middle: '#4CC38A', high: '#F0B860', ultra_high: '#F59A6B', rich: '#B9A4F0' },
};

export const CLASS_COLORS: Record<string, string> = CLASS_COLOR_SETS[SCHEME];

export const CLASS_LABELS: Record<string, string> = {
  low: 'Low',
  middle: 'Middle',
  high: 'High',
  ultra_high: 'Ultra-high',
  rich: 'Rich',
};

// ---------- type ----------
// Loaded in app/_layout.tsx. Headings: Space Grotesk 700 (30/26/20).
// Body/UI: DM Sans 400/500/700 (17/15/13). Devanagari: Hind.
export const FONTS = {
  display: 'SpaceGrotesk_700Bold',
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_700Bold',
  hindiMedium: 'Hind_500Medium',
};

export const TYPE = {
  h1: 30,
  h2: 26,
  h3: 20,
  body: 17,
  ui: 15,
  caption: 13,
  amount: 34,
};

// Amount text: bold with tabular figures so columns line up.
export const AMOUNT_TEXT = { fontFamily: FONTS.bold, fontVariant: ['tabular-nums' as const] };

// ---------- spacing, shape, touch ----------
// 4-point scale. Keys kept from the old theme so existing screens are unchanged.
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const SPACE = [0, 4, 8, 12, 16, 20, 24, 28, 32] as const;

export const RADIUS = {
  sm: 8,
  md: 12, // inputs
  lg: 16, // existing screens' cards
  button: 14, // Prapanji buttons and cards
  sheet: 20,
  full: 999, // chips
};

export const CONTROL = {
  minTouch: 44,
  primaryHeight: 54,
  secondaryHeight: 52,
};
