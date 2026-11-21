import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DateInput } from './DateInput';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../constants/theme';
import { DatePreset, DateRange, customRange, customRangeError, presetHint, presetRange } from '../utils/dateRanges';
import { todayLocalIso } from '../utils/dates';

interface Props {
  visible: boolean;
  /** The range in force now, or null for none. */
  active: DateRange | null;
  /** A range to apply, or null to clear. */
  onApply: (range: DateRange | null) => void;
  onClose: () => void;
}

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'year', label: 'This year' },
];

/**
 * The Dates filter on the Transactions tab: this week, this month, this year, or a custom
 * From and To (typed or from the calendar). A quick choice applies at once; a custom range
 * applies on Show. Both days are included.
 */
export const DateFilterSheet: React.FC<Props> = ({ visible, active, onApply, onClose }) => {
  const today = todayLocalIso();
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Each opening starts from what is applied now.
  useEffect(() => {
    if (!visible) return;
    const isCustom = !!active && !active.preset;
    setCustomOpen(isCustom);
    setFrom(isCustom ? active!.from : '');
    setTo(isCustom ? active!.to : '');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const choose = (preset: DatePreset) => {
    onApply(presetRange(preset, today));
    onClose();
  };

  const show = () => {
    const problem = customRangeError(from, to);
    if (problem) {
      setError(problem);
      return;
    }
    onApply(customRange(from, to));
    onClose();
  };

  const clear = () => {
    onApply(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType={MODAL_ANIMATION} transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}} accessibilityLabel="Filter by dates">
          <View style={styles.grab} />
          <Text style={styles.title}>Show transactions from</Text>

          {PRESETS.map((p) => {
            const selected = active?.preset === p.key;
            return (
              <Pressable
                key={p.key}
                style={[styles.row, selected && styles.rowActive]}
                onPress={() => choose(p.key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${p.label}, ${presetHint(p.key, today)}`}
              >
                <Text style={[styles.rowLabel, selected && styles.rowLabelActive]}>{p.label}</Text>
                <Text style={styles.rowHint}>{presetHint(p.key, today)}</Text>
              </Pressable>
            );
          })}

          <Pressable
            style={[styles.row, (customOpen || (!!active && !active.preset)) && styles.rowActive]}
            onPress={() => setCustomOpen(true)}
            accessibilityRole="button"
            accessibilityState={{ expanded: customOpen }}
          >
            <Text style={[styles.rowLabel, (customOpen || (!!active && !active.preset)) && styles.rowLabelActive]}>Custom range</Text>
            <Ionicons name={customOpen ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textMuted} />
          </Pressable>

          {customOpen && (
            <View style={styles.custom}>
              <View style={styles.pair}>
                <View style={styles.half}>
                  <Text style={styles.label}>From</Text>
                  <DateInput value={from} onChange={(v) => { setFrom(v); setError(null); }} inputStyle={styles.input} accessibilityLabel="From date" />
                </View>
                <View style={styles.half}>
                  <Text style={styles.label}>To</Text>
                  <DateInput value={to} onChange={(v) => { setTo(v); setError(null); }} min={from.length === 10 ? from : undefined} inputStyle={styles.input} accessibilityLabel="To date" />
                </View>
              </View>
              <Text style={styles.hint}>Both days are included. Tap the calendar to pick a day.</Text>
              {error && <Text style={styles.error}>{error}</Text>}
            </View>
          )}

          <View style={styles.footer}>
            <Pressable style={styles.btn} onPress={clear} accessibilityRole="button">
              <Text style={styles.btnText}>Clear</Text>
            </Pressable>
            {customOpen && (
              <Pressable style={[styles.btn, styles.btnPrimary]} onPress={show} accessibilityRole="button">
                <Text style={[styles.btnText, styles.btnPrimaryText]}>Show</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 400, alignSelf: 'center', backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, paddingTop: SPACING.sm, gap: SPACING.sm },
  grab: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.cardBorder, marginBottom: SPACING.xs },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12 },
  rowActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accent + '14' },
  rowLabel: { color: COLORS.text, fontSize: 15 },
  rowLabelActive: { color: COLORS.accent, fontWeight: '600' },
  rowHint: { color: COLORS.textMuted, fontSize: 13 },
  custom: { gap: SPACING.xs },
  pair: { flexDirection: 'row', gap: SPACING.sm },
  half: { flex: 1, gap: 4 },
  label: { color: COLORS.textMuted, fontSize: 12 },
  input: { backgroundColor: COLORS.input, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: 10, color: COLORS.text, fontSize: 14 },
  hint: { color: COLORS.textDim, fontSize: 12 },
  error: { color: COLORS.red, fontSize: 13 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.xs, marginTop: SPACING.xs },
  btn: { borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.md, paddingHorizontal: SPACING.lg, paddingVertical: 10 },
  btnText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  btnPrimary: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  btnPrimaryText: { color: COLORS.onAccent },
});
