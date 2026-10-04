import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, TextInputProps, ViewStyle, StyleProp } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { COLORS, RADIUS, SPACING } from '../constants/theme';

// Small shared building blocks for the stack screens (settings, accounts,
// budgets, staff, password reset) so they match the tab screens' look
// without each re-declaring the same styles.

export const fmtInr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

/** Title row with a back button; falls back to the dashboard when there is no history (e.g. opened from an email link). */
export const ScreenHeader: React.FC<{ title: string; right?: React.ReactNode }> = ({ title, right }) => (
  <View style={styles.header}>
    <Pressable
      hitSlop={8}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      style={styles.backBtn}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <Ionicons name="chevron-back" size={22} color={COLORS.text} />
    </Pressable>
    <Text style={styles.headerTitle} numberOfLines={1}>
      {title}
    </Text>
    <View style={styles.headerRight}>{right}</View>
  </View>
);

export const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => <Text style={styles.sectionTitle}>{children}</Text>;

export const Field: React.FC<TextInputProps & { label: string; hint?: string }> = ({ label, hint, style, ...input }) => (
  <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput placeholderTextColor={COLORS.textDim} style={[styles.input, style]} {...input} />
    {hint ? <Text style={styles.hint}>{hint}</Text> : null}
  </View>
);

export const Button: React.FC<{
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}> = ({ label, onPress, variant = 'primary', disabled, style }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    style={[styles.btn, variant === 'primary' ? styles.btnPrimary : variant === 'danger' ? styles.btnDanger : styles.btnOutline, disabled && styles.btnDisabled, style]}
  >
    <Text style={[styles.btnText, variant === 'primary' ? styles.btnTextPrimary : variant === 'danger' ? styles.btnTextDanger : styles.btnTextOutline]}>
      {label}
    </Text>
  </Pressable>
);

/** Row of mutually exclusive options (segmented control). */
export function Segmented<T extends string>({ options, value, onChange }: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segment}>
      {options.map((o) => (
        <Pressable key={o.key} style={[styles.segmentBtn, value === o.key && styles.segmentBtnActive]} onPress={() => onChange(o.key)}>
          <Text style={[styles.segmentText, value === o.key && styles.segmentTextActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const ErrorText: React.FC<{ message: string | null }> = ({ message }) => (message ? <Text style={styles.error}>{message}</Text> : null);

export const Notice: React.FC<{ tone?: 'info' | 'warning' | 'success'; children: React.ReactNode }> = ({ tone = 'info', children }) => (
  <View style={[styles.notice, { borderColor: tone === 'warning' ? COLORS.yellow : tone === 'success' ? COLORS.accent : COLORS.blue }]}>
    <Text style={styles.noticeText}>{children}</Text>
  </View>
);

export const kit = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: SPACING.lg, paddingTop: 0, paddingBottom: SPACING.xl * 2, gap: SPACING.md },
  muted: { color: COLORS.textMuted, fontSize: 13 },
  dim: { color: COLORS.textDim, fontSize: 12 },
  empty: { color: COLORS.textDim, fontSize: 13, textAlign: 'center', paddingVertical: SPACING.lg },
});

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', padding: SPACING.lg, paddingBottom: SPACING.md, gap: SPACING.sm },
  backBtn: { padding: 2 },
  headerTitle: { flex: 1, color: COLORS.text, fontSize: 20, fontWeight: '700' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  sectionTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginTop: SPACING.sm },
  field: { gap: SPACING.xs },
  label: { color: COLORS.textMuted, fontSize: 13 },
  hint: { color: COLORS.textDim, fontSize: 11.5 },
  input: {
    backgroundColor: COLORS.input,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    color: COLORS.text,
    fontSize: 15,
  },
  btn: { borderRadius: RADIUS.md, paddingVertical: 13, alignItems: 'center' },
  btnPrimary: { backgroundColor: COLORS.accent },
  btnOutline: { borderWidth: 1, borderColor: COLORS.cardBorder },
  btnDanger: { borderWidth: 1, borderColor: COLORS.red },
  btnDisabled: { opacity: 0.5 },
  btnText: { fontWeight: '700', fontSize: 15 },
  btnTextPrimary: { color: COLORS.onAccent },
  btnTextOutline: { color: COLORS.text },
  btnTextDanger: { color: COLORS.red },
  segment: { flexDirection: 'row', backgroundColor: COLORS.input, borderRadius: RADIUS.md, padding: 4 },
  segmentBtn: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: RADIUS.sm },
  segmentBtnActive: { backgroundColor: COLORS.accent },
  segmentText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 13 },
  segmentTextActive: { color: COLORS.onAccent },
  error: { color: COLORS.red, fontSize: 13 },
  notice: { borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md, backgroundColor: COLORS.card },
  noticeText: { color: COLORS.text, fontSize: 13, lineHeight: 19 },
});
