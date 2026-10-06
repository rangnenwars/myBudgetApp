import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { isValidIsoDate, shiftIsoDate, todayLocalIso } from '../utils/dates';

interface Props {
  /** 'YYYY-MM-DD', or '' for no date. */
  value: string;
  onChange: (value: string) => void;
}

const PRESETS = [
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
];

/** Optional date in the future, for "pay back by". (DateField only allows today or earlier.) */
export const DueDateField: React.FC<Props> = ({ value, onChange }) => {
  const today = todayLocalIso();
  const [other, setOther] = useState(false);
  const showOther = other && !PRESETS.some((p) => shiftIsoDate(today, p.days) === value);
  const error = value && !isValidIsoDate(value) ? 'Enter a real date as YYYY-MM-DD.' : value && value < today ? 'Pick today or a later date.' : null;

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable key={label} style={[styles.chip, active && styles.chipActive]} onPress={onPress} accessibilityRole="button">
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {chip('No date', !value && !other, () => {
          setOther(false);
          onChange('');
        })}
        {PRESETS.map((p) =>
          chip(p.label, !other && value === shiftIsoDate(today, p.days), () => {
            setOther(false);
            onChange(shiftIsoDate(today, p.days));
          })
        )}
        {chip('Other', other, () => {
          setOther(true);
          if (value && !isValidIsoDate(value)) onChange('');
        })}
      </View>
      {(other || showOther) && (
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={COLORS.textDim}
          autoCapitalize="none"
          maxLength={10}
          accessibilityLabel="Pay back by date"
        />
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
};

/** Error text for an optional pay-back-by value, or null when it is empty or a valid date from today on. */
export const dueDateError = (value: string): string | null => {
  if (!value) return null;
  if (!isValidIsoDate(value)) return 'Enter the pay-back date as YYYY-MM-DD.';
  if (value < todayLocalIso()) return 'The pay-back date can\'t be in the past.';
  return null;
};

const styles = StyleSheet.create({
  wrap: { gap: SPACING.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: { borderColor: COLORS.cardBorder, borderWidth: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 7 },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { color: COLORS.text, fontSize: 13 },
  chipTextActive: { color: COLORS.onAccent, fontWeight: '600' },
  input: {
    backgroundColor: COLORS.input,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    color: COLORS.text,
    fontSize: 15,
  },
  error: { color: COLORS.red, fontSize: 12 },
});
