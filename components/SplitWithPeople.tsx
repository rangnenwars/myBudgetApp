import React from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { Card } from './Card';
import { Segmented } from './ScreenKit';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { splitEqually } from '../utils/calculations';
import { Person } from '../utils/types';
import { fmtAmount } from '../utils/people';

export interface PeopleSplitState {
  /** Ids of the people picked from the list. */
  picked: number[];
  method: 'equal' | 'custom';
  /** Typed share per person id; key 0 is the new person typed below the list. */
  shares: Record<number, string>;
  newName: string;
}

export const emptyPeopleSplit = (): PeopleSplitState => ({ picked: [], method: 'equal', shares: {}, newName: '' });

const NEW = 0;

const rowKeys = (v: PeopleSplitState): number[] => [...v.picked, ...(v.newName.trim() ? [NEW] : [])];

/** Each friend's share and what stays with the user, for the amount typed so far. */
export const planPeopleSplit = (total: number, v: PeopleSplitState): { keys: number[]; shares: Record<number, number>; myShare: number } => {
  const keys = rowKeys(v);
  const shares: Record<number, number> = {};
  if (v.method === 'equal') {
    const { friendShare } = splitEqually(total, keys.length);
    for (const k of keys) shares[k] = friendShare;
  } else {
    for (const k of keys) shares[k] = parseFloat(v.shares[k] ?? '') || 0;
  }
  const friendsCents = keys.reduce((s, k) => s + Math.round(shares[k] * 100), 0);
  return { keys, shares, myShare: (Math.round(total * 100) - friendsCents) / 100 };
};

/** Why the split can't be saved yet, or null when it can. */
export const peopleSplitProblem = (total: number, v: PeopleSplitState): string | null => {
  const plan = planPeopleSplit(total, v);
  if (plan.keys.length === 0) return 'Choose at least one person.';
  if (plan.keys.some((k) => !(plan.shares[k] > 0))) return v.method === 'equal' ? 'That amount is too small to split.' : "Enter each person's share.";
  if (plan.myShare < 0) return `The shares are ${fmtAmount(-plan.myShare)} more than the total.`;
  return null;
};

interface Props {
  total: number;
  people: Person[];
  value: PeopleSplitState;
  onChange: (next: PeopleSplitState) => void;
}

/** "Split with people": pick friends, share equally or by amount, and see what counts as your spending. */
export const SplitWithPeople: React.FC<Props> = ({ total, people, value, onChange }) => {
  const plan = planPeopleSplit(total, value);
  const nameOf = (k: number) => (k === NEW ? value.newName.trim() : people.find((p) => p.id === k)?.name ?? '');
  const toggle = (id: number) =>
    onChange({ ...value, picked: value.picked.includes(id) ? value.picked.filter((x) => x !== id) : [...value.picked, id] });

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Split with</Text>
      {people.length > 0 && (
        <View style={styles.chips}>
          {people.map((p) => {
            const on = value.picked.includes(p.id);
            return (
              <Pressable key={p.id} style={[styles.chip, on && styles.chipActive]} onPress={() => toggle(p.id)} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextActive]}>{p.name}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <TextInput
        style={styles.input}
        value={value.newName}
        onChangeText={(newName) => onChange({ ...value, newName })}
        placeholder={people.length > 0 ? 'Or type a new person' : 'Type a name'}
        placeholderTextColor={COLORS.textDim}
        maxLength={60}
        accessibilityLabel="New person to split with"
      />

      <Segmented
        options={[
          { key: 'equal', label: 'Equal' },
          { key: 'custom', label: 'Custom' },
        ]}
        value={value.method}
        onChange={(method) => onChange({ ...value, method })}
      />

      {value.method === 'custom' &&
        plan.keys.map((k) => (
          <View key={k} style={styles.shareRow}>
            <Text style={styles.shareName} numberOfLines={1}>
              {nameOf(k)}
            </Text>
            <TextInput
              style={[styles.input, styles.shareInput]}
              value={value.shares[k] ?? ''}
              onChangeText={(v) => onChange({ ...value, shares: { ...value.shares, [k]: v } })}
              placeholder="0"
              placeholderTextColor={COLORS.textDim}
              keyboardType="numeric"
              accessibilityLabel={`Share for ${nameOf(k)}`}
            />
          </View>
        ))}

      {plan.keys.length > 0 && total > 0 && (
        <Card>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Your share</Text>
            <Text style={[styles.sumValue, plan.myShare < 0 && { color: COLORS.red }]}>{fmtAmount(plan.myShare)}</Text>
          </View>
          <Text style={styles.hint}>This is what counts as your spending</Text>
          {plan.keys.map((k) => (
            <View key={k} style={styles.sumRow}>
              <Text style={styles.sumLabel} numberOfLines={1}>
                {nameOf(k)} owes you
              </Text>
              <Text style={[styles.sumValue, { color: COLORS.positive }]}>{fmtAmount(plan.shares[k])}</Text>
            </View>
          ))}
        </Card>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: SPACING.sm },
  label: { color: COLORS.textMuted, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
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
    paddingVertical: 12,
    color: COLORS.text,
    fontSize: 15,
  },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  shareName: { flex: 1, color: COLORS.text, fontSize: 14 },
  shareInput: { width: 110, textAlign: 'right' },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.sm, paddingVertical: 2 },
  sumLabel: { color: COLORS.text, fontSize: 14, flexShrink: 1 },
  sumValue: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  hint: { color: COLORS.textDim, fontSize: 12, marginBottom: SPACING.xs },
});
