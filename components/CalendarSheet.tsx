import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../constants/theme';
import { isValidIsoDate, todayLocalIso } from '../utils/dates';
import { MONTH_LONG, MONTH_SHORT, WEEKDAYS, addMonthsTo, isoOf, monthCells, monthOutOfRange, outOfRange } from '../utils/calendar';

interface Props {
  visible: boolean;
  /** Current 'YYYY-MM-DD' (or anything else, e.g. half-typed, to start on today). */
  value: string;
  /** Earliest / latest pickable day; days outside are greyed out. */
  min?: string;
  max?: string;
  onSelect: (iso: string) => void;
  onClose: () => void;
}

/**
 * Month calendar in a bottom sheet. Built from plain components because
 * @react-native-community/datetimepicker has no web support (Expo SDK 57 docs)
 * and the app is used as a web build. Nothing is applied until Done.
 */
export const CalendarSheet: React.FC<Props> = ({ visible, value, min, max, onSelect, onClose }) => {
  const today = todayLocalIso();
  const [view, setView] = useState({ year: 0, month: 0 });
  const [draft, setDraft] = useState<string | null>(null);
  const [pickingMonth, setPickingMonth] = useState(false);

  // Each opening starts from the field's current value.
  useEffect(() => {
    if (!visible) return;
    const start = isValidIsoDate(value) ? value : today;
    const [y, m] = start.split('-').map(Number);
    setView({ year: y, month: m });
    setDraft(isValidIsoDate(value) && !outOfRange(value, min, max) ? value : null);
    setPickingMonth(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!view.year) return null;

  const shift = (delta: number) => setView((v) => addMonthsTo(v.year, v.month, pickingMonth ? delta * 12 : delta));
  const goToday = () => {
    const [y, m] = today.split('-').map(Number);
    setView({ year: y, month: m });
    if (!outOfRange(today, min, max)) setDraft(today);
    setPickingMonth(false);
  };
  const done = () => {
    if (draft) onSelect(draft);
    onClose();
  };

  return (
    <Modal visible={visible} animationType={MODAL_ANIMATION} transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}} accessibilityLabel="Pick a date">
          <View style={styles.grab} />
          <View style={styles.header}>
            <Pressable onPress={() => shift(-1)} hitSlop={8} accessibilityLabel={pickingMonth ? 'Previous year' : 'Previous month'}>
              <Ionicons name="chevron-back" size={20} color={COLORS.text} />
            </Pressable>
            <Pressable style={styles.title} onPress={() => setPickingMonth((p) => !p)} accessibilityLabel="Choose month and year">
              <Text style={styles.titleText}>{pickingMonth ? view.year : `${MONTH_LONG[view.month - 1]} ${view.year}`}</Text>
              {!pickingMonth && <Ionicons name="chevron-down" size={14} color={COLORS.textMuted} />}
            </Pressable>
            <Pressable onPress={() => shift(1)} hitSlop={8} accessibilityLabel={pickingMonth ? 'Next year' : 'Next month'}>
              <Ionicons name="chevron-forward" size={20} color={COLORS.text} />
            </Pressable>
          </View>

          {pickingMonth ? (
            <View style={styles.months}>
              {MONTH_SHORT.map((label, i) => {
                const disabled = monthOutOfRange(view.year, i + 1, min, max);
                const current = i + 1 === view.month;
                return (
                  <Pressable
                    key={label}
                    style={[styles.monthCell, current && styles.selected, disabled && styles.off]}
                    disabled={disabled}
                    onPress={() => {
                      setView({ year: view.year, month: i + 1 });
                      setPickingMonth(false);
                    }}
                  >
                    <Text style={[styles.cellText, current && styles.selectedText]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <>
              <View style={styles.week}>
                {WEEKDAYS.map((w) => (
                  <Text key={w} style={styles.weekday}>{w}</Text>
                ))}
              </View>
              <View style={styles.grid}>
                {monthCells(view.year, view.month).map((day, i) => {
                  if (day == null) return <View key={`b${i}`} style={styles.cell} />;
                  const iso = isoOf(view.year, view.month, day);
                  const disabled = outOfRange(iso, min, max);
                  const selected = iso === draft;
                  return (
                    <View key={iso} style={styles.cell}>
                      <Pressable
                        style={[styles.day, iso === today && !selected && styles.todayRing, selected && styles.selected]}
                        disabled={disabled}
                        onPress={() => setDraft(iso)}
                        accessibilityRole="button"
                        accessibilityState={{ selected, disabled }}
                        accessibilityLabel={iso}
                      >
                        <Text style={[styles.cellText, disabled && styles.offText, selected && styles.selectedText]}>{day}</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          <View style={styles.footer}>
            <Pressable style={styles.btn} onPress={goToday}>
              <Text style={styles.btnText}>Today</Text>
            </Pressable>
            <View style={styles.footerRight}>
              <Pressable style={styles.btn} onPress={onClose}>
                <Text style={styles.btnText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnPrimary]} onPress={done}>
                <Text style={[styles.btnText, styles.btnPrimaryText]}>Done</Text>
              </Pressable>
            </View>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: SPACING.sm },
  titleText: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', color: COLORS.textDim, fontSize: 11, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  day: { width: '86%', aspectRatio: 1, borderRadius: RADIUS.full, alignItems: 'center', justifyContent: 'center' },
  todayRing: { borderWidth: 1, borderColor: COLORS.accent },
  selected: { backgroundColor: COLORS.accent },
  selectedText: { color: COLORS.onAccent, fontWeight: '700' },
  cellText: { color: COLORS.text, fontSize: 14 },
  offText: { color: COLORS.textDim, opacity: 0.4 },
  off: { opacity: 0.35 },
  months: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  monthCell: { width: '31.5%', alignItems: 'center', paddingVertical: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.cardBorder },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.xs },
  footerRight: { flexDirection: 'row', gap: SPACING.xs },
  btn: { borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 10 },
  btnText: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  btnPrimary: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  btnPrimaryText: { color: COLORS.onAccent },
});
