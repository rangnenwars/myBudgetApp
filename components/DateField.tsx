import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { entryDateError, isValidIsoDate, shiftIsoDate, todayLocalIso } from '../utils/dates';

interface Props {
  /** 'YYYY-MM-DD'. May be mid-edit/invalid while the user types in the custom field. */
  value: string;
  onChange: (value: string) => void;
}

// Built from plain components on purpose: @react-native-community/datetimepicker
// has no web support (Expo SDK 57 docs), and the app is used as a web build.
export const DateField: React.FC<Props> = ({ value, onChange }) => {
  const today = todayLocalIso();
  const yesterday = shiftIsoDate(today, -1);
  const [custom, setCustom] = useState(value !== today && value !== yesterday);

  const error = entryDateError(value, today);
  const showCustom = custom || (value !== today && value !== yesterday);
  const step = (days: number) => {
    if (isValidIsoDate(value)) onChange(shiftIsoDate(value, days));
  };
  const canStepForward = isValidIsoDate(value) && value < today;
  const label = isValidIsoDate(value)
    ? new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  const chip = (text: string, active: boolean, onPress: () => void) => (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{text}</Text>
    </Pressable>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.chipRow}>
        {chip('Today', !showCustom && value === today, () => { setCustom(false); onChange(today); })}
        {chip('Yesterday', !showCustom && value === yesterday, () => { setCustom(false); onChange(yesterday); })}
        {chip('Other date', showCustom, () => setCustom(true))}
      </View>

      {showCustom && (
        <View style={styles.customRow}>
          <Pressable style={styles.stepBtn} onPress={() => step(-1)} disabled={!isValidIsoDate(value)} hitSlop={6}>
            <Ionicons name="chevron-back" size={18} color={COLORS.text} />
          </Pressable>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={onChange}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={COLORS.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={10}
          />
          <Pressable style={[styles.stepBtn, !canStepForward && styles.stepBtnDisabled]} onPress={() => step(1)} disabled={!canStepForward} hitSlop={6}>
            <Ionicons name="chevron-forward" size={18} color={COLORS.text} />
          </Pressable>
        </View>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : label ? <Text style={styles.hint}>{label}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: SPACING.xs },
  chipRow: { flexDirection: 'row', gap: SPACING.xs },
  chip: { borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 8 },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#04140D' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  stepBtn: { backgroundColor: COLORS.input, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, padding: 10 },
  stepBtnDisabled: { opacity: 0.4 },
  input: {
    flex: 1,
    backgroundColor: COLORS.input,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    color: COLORS.text,
    fontSize: 15,
    textAlign: 'center',
  },
  hint: { color: COLORS.textDim, fontSize: 12 },
  error: { color: COLORS.red, fontSize: 12 },
});
