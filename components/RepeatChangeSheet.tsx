import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../constants/theme';

interface Props {
  visible: boolean;
  /** Formatted amounts, e.g. "₹50,000". */
  from: string;
  to: string;
  frequency: 'monthly' | 'quarterly' | 'yearly';
  /** true = move the repeat to the new amount too; false = change only this entry. */
  onChoose: (changeRepeat: boolean) => void;
  /** Tapping outside: back to the form, nothing saved. */
  onClose: () => void;
}

const EVERY: Record<Props['frequency'], string> = { monthly: 'every month', quarterly: 'every 3 months', yearly: 'every year' };

/** Asked when the amount of an entry that repeats is changed. Plan ahead and the next posting follow the repeat. */
export const RepeatChangeSheet: React.FC<Props> = ({ visible, from, to, frequency, onChoose, onClose }) => (
  <Modal visible={visible} animationType={MODAL_ANIMATION} transparent onRequestClose={onClose}>
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable style={styles.sheet} onPress={() => {}} accessibilityLabel="This entry repeats">
        <View style={styles.grab} />
        <Text style={styles.title}>This entry repeats {EVERY[frequency]}</Text>
        <Text style={styles.body}>
          You changed the amount from {from} to {to}. Use {to} for the months ahead too? Plan ahead follows the repeat.
        </Text>
        <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => onChoose(true)} accessibilityRole="button">
          <Text style={[styles.btnText, styles.btnPrimaryText]}>This and future months</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => onChoose(false)} accessibilityRole="button">
          <Text style={styles.btnText}>Only this one</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  </Modal>
);

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 400, alignSelf: 'center', backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, paddingTop: SPACING.sm, gap: SPACING.sm },
  grab: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.cardBorder, marginBottom: SPACING.xs },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  body: { color: COLORS.textMuted, fontSize: 14, lineHeight: 20 },
  btn: { alignItems: 'center', borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.md, paddingVertical: 12 },
  btnText: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  btnPrimary: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  btnPrimaryText: { color: COLORS.onAccent },
});
