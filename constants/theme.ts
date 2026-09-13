import { Platform } from 'react-native';

// react-native-web's Modal "slide" animation can get stuck fully off-screen
// (the enter transform never resolves), so web falls back to a plain fade.
export const MODAL_ANIMATION: 'slide' | 'fade' = Platform.OS === 'web' ? 'fade' : 'slide';

export const COLORS = {
  bg: '#0A0F1E',
  card: '#111827',
  cardBorder: '#1F2937',
  input: '#0D1117',
  adminBg: '#1A0F0F',
  accent: '#10B981',
  accentDim: '#6EE7B7',
  red: '#F87171',
  yellow: '#FBBF24',
  blue: '#60A5FA',
  purple: '#A78BFA',
  adminRed: '#991B1B',
  proGold: '#F59E0B',
  text: '#F9FAFB',
  textMuted: '#9CA3AF',
  textDim: '#4B5563',
};

export const CLASS_COLORS: Record<string, string> = {
  low: '#60A5FA',
  middle: '#34D399',
  high: '#FBBF24',
  ultra_high: '#F97316',
  rich: '#A78BFA',
};

export const CLASS_LABELS: Record<string, string> = {
  low: 'Low',
  middle: 'Middle',
  high: 'High',
  ultra_high: 'Ultra-high',
  rich: 'Rich',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
};
