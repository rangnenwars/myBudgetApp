import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { CalendarSheet } from './CalendarSheet';
import Ionicons from '@expo/vector-icons/Ionicons';
import { END_PRESET_MONTHS, RepeatEndChoice, endsOnFor, formatEndDate, repeatEndError, repeatPreview } from '../utils/repeatEnd';
import { RepeatFrequency } from '../utils/types';

interface Props {
  /** Earliest allowed end date, and what "3 months" etc. count from: the entry's date, or today when editing a rule. */
  base: string;
  /** The first date an automatic entry would be added on. */
  firstDue: string;
  frequency: RepeatFrequency;
  day: number;
  value: RepeatEndChoice | null;
  onChange: (value: RepeatEndChoice | null) => void;
  /** Show "Choose when this ends" even though nothing has been picked yet (after a failed Save). */
  showError?: boolean;
}

/** Required "Ends on" choice for a repeating entry: a few months, a date, or an explicit no end date. */
export const RepeatEndField: React.FC<Props> = ({ base, firstDue, frequency, day, value, onChange, showError }) => {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const error = value || showError ? repeatEndError(base, value) : null;
  const endsOn = error ? null : endsOnFor(base, value);
  const preview = endsOn ? repeatPreview(firstDue, frequency, day, endsOn) : null;

  const chip = (text: string, active: boolean, onPress: () => void) => (
    <Pressable key={text} style={[styles.chip, active && styles.chipActive]} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{text}</Text>
    </Pressable>
  );

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Ends on (required)</Text>
      <View style={styles.chipRow}>
        {END_PRESET_MONTHS.map((n) => chip(`${n} months`, value?.kind === 'months' && value.months === n, () => onChange({ kind: 'months', months: n })))}
        {chip('Pick a date', value?.kind === 'date', () => onChange({ kind: 'date', date: value?.kind === 'date' ? value.date : '' }))}
        {chip('No end date', value?.kind === 'none', () => onChange({ kind: 'none' }))}
      </View>

      {value?.kind === 'date' && (
        <View style={styles.dateRow}>
          <TextInput
            style={[styles.input, styles.dateInput]}
            value={value.date}
            onChangeText={(date) => onChange({ kind: 'date', date })}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={COLORS.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={10}
          />
          <Pressable style={styles.calBtn} onPress={() => setCalendarOpen(true)} hitSlop={6} accessibilityLabel="Open calendar">
            <Ionicons name="calendar-outline" size={18} color={COLORS.accent} />
          </Pressable>
        </View>
      )}

      <CalendarSheet
        visible={calendarOpen}
        value={value?.kind === 'date' ? value.date : ''}
        min={base}
        onSelect={(date) => onChange({ kind: 'date', date })}
        onClose={() => setCalendarOpen(false)}
      />

      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : value?.kind === 'none' ? (
        <Text style={styles.hint}>Keeps adding this until you stop it. Use it for things with no set end, like salary or rent.</Text>
      ) : endsOn && preview ? (
        <>
          <Text style={styles.endLine}>Ends {formatEndDate(endsOn)}</Text>
          <Text style={styles.hint}>
            {preview.count === 0
              ? 'No entry falls before this date, so nothing would be added.'
              : preview.count === 1
                ? `1 entry, on ${formatEndDate(preview.first!)}.`
                : `${preview.count} entries: first ${formatEndDate(preview.first!)}, last ${formatEndDate(preview.last!)}.`}
          </Text>
        </>
      ) : (
        <Text style={styles.hint}>Entries stop after this date. Ones already added stay.</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: SPACING.xs, marginTop: SPACING.xs },
  label: { color: COLORS.textMuted, fontSize: 13 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: { borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 8 },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: COLORS.onAccent },
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
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  dateInput: { flex: 1 },
  calBtn: { backgroundColor: COLORS.input, borderColor: COLORS.accent, borderWidth: 1, borderRadius: RADIUS.md, padding: 10 },
  endLine: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  hint: { color: COLORS.textDim, fontSize: 12 },
  error: { color: COLORS.red, fontSize: 12 },
});
