import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Card } from '../components/Card';
import { FreeMoneyBar, dayLabel, weekChange } from '../components/FreeMoneyCard';
import { MiniBar } from '../components/MiniBar';
import { ScreenHeader, SectionTitle, Notice, fmtInr } from '../components/ScreenKit';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { getFreeMoneyDay, FreeMoneyDayInfo, computeFreeMoneyDay, computePartPayment } from '../utils/database';

export default function FreeMoneyDayScreen() {
  const { user } = useAuth();
  const [info, setInfo] = useState<FreeMoneyDayInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [loanId, setLoanId] = useState<number | null>(null);
  const [prepay, setPrepay] = useState('');

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      getFreeMoneyDay()
        .then((r) => {
          if (!active) return;
          setInfo(r);
          setFailed(false);
          setLoanId((id) => (r.loans.some((l) => l.id === id) ? id : r.loans[0]?.id ?? null));
        })
        .catch(() => active && setFailed(true));
      return () => {
        active = false;
      };
    }, [user?.id])
  );

  // What the free-money day would be if the chosen loan got a part payment (same maths as the Loans screen).
  const preview = useMemo(() => {
    if (!info || info.status === 'no_income') return null;
    const loan = info.loans.find((l) => l.id === loanId);
    const value = parseFloat(prepay);
    if (!loan || !(value > 0)) return null;
    if (value > loan.outstanding) return { error: `That is more than the ${fmtInr(loan.outstanding)} still owed on this loan.` } as const;
    const after = computePartPayment(loan, value);
    const oldEmi = Math.min(loan.emi, loan.outstanding);
    const newEmi = after.outstanding <= 0 ? 0 : Math.min(after.emi, after.outstanding);
    const result = computeFreeMoneyDay(info.income, info.committed - (oldEmi - newEmi), info.daysInMonth);
    return { loan, oldEmi, newEmi, result } as const;
  }, [info, loanId, prepay]);

  if (!info) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="Free-money day" />
        <View style={styles.center}>{failed ? <Text style={styles.muted}>Could not load this. Pull back and try again.</Text> : <ActivityIndicator color={COLORS.accent} />}</View>
      </View>
    );
  }

  const change = weekChange(info.daysEarlier);
  const incomeNote = info.incomeSource === 'repeating' ? 'Income from your repeating entries.' : "Income is the average of your last full months.";
  const dayText = info.day != null && info.day > 0 && info.status === 'ok' ? dayLabel(info.year, info.month, info.day) : null;

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Free-money day" />
      <ScrollView contentContainerStyle={styles.container}>
        <Card>
          {info.status === 'no_income' ? (
            <Text style={styles.muted}>Add your income as a repeating entry, or log a few months of income, to see your free-money day.</Text>
          ) : info.status === 'over' ? (
            <>
              <Text style={[styles.big, { color: COLORS.red }]}>No free days</Text>
              <Text style={styles.muted}>Your fixed bills and EMIs add up to {fmtInr(info.committed)}, which is {Math.round(info.share * 100)}% of your income.</Text>
            </>
          ) : (
            <>
              <Text style={styles.small}>{dayText ? 'Everything fixed is paid for by' : 'Nothing fixed is due'}</Text>
              <Text style={styles.big}>{dayText ?? 'Every day is free'}</Text>
              {info.day! > 0 && <FreeMoneyBar day={info.day!} daysInMonth={info.daysInMonth} />}
              <Text style={styles.muted}>
                {info.daysFree} {info.daysFree === 1 ? 'day' : 'days'} left in the month that are yours to spend.
              </Text>
            </>
          )}
          {info.status !== 'no_income' && (
            <View style={styles.rowBetween}>
              <Text style={styles.small}>{Math.round(info.share * 100)}% of income committed</Text>
              {change && <Text style={[styles.small, { color: change.color, fontWeight: '600' }]}>{change.text}</Text>}
            </View>
          )}
          {info.previous && info.status !== 'no_income' && (
            <Text style={styles.small}>Last week: {dayLabel(info.year, info.month, info.previous.day || 1)}</Text>
          )}
        </Card>

        {info.status !== 'no_income' && (
          <>
            <SectionTitle>What you owe every month</SectionTitle>
            <Card>
              {info.items.length === 0 ? (
                <Text style={styles.muted}>No loans or repeating bills yet.</Text>
              ) : (
                info.items.map((it, i) => (
                  <View key={`${it.kind}-${it.label}-${i}`} style={[styles.item, i !== 0 && styles.itemBorder]}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.itemLabel} numberOfLines={1}>
                        {it.label}
                      </Text>
                      <Text style={styles.itemAmount}>{fmtInr(it.amount)}</Text>
                    </View>
                    <Text style={styles.small}>{it.kind === 'loan' ? 'Loan EMI' : 'Repeating'}</Text>
                    <MiniBar percent={Math.min(100, (it.amount / info.income) * 100)} color={it.kind === 'loan' ? COLORS.blue : COLORS.purple} />
                  </View>
                ))
              )}
              <View style={[styles.rowBetween, styles.itemBorder, { paddingTop: SPACING.sm }]}>
                <Text style={styles.itemLabel}>Committed of {fmtInr(info.income)} income</Text>
                <Text style={styles.itemAmount}>{fmtInr(info.committed)}</Text>
              </View>
              <Text style={styles.small}>{incomeNote}</Text>
            </Card>

            <SectionTitle>What if you prepay a loan</SectionTitle>
            <Card>
              {info.loans.length === 0 ? (
                <Text style={styles.muted}>Add a loan under Loans to try a part payment here.</Text>
              ) : (
                <>
                  {info.loans.length > 1 && (
                    <View style={styles.chips}>
                      {info.loans.map((l) => (
                        <Pressable key={l.id} style={[styles.chip, loanId === l.id && styles.chipActive]} onPress={() => setLoanId(l.id)}>
                          <Text style={[styles.chipText, loanId === l.id && styles.chipTextActive]}>{l.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  <Text style={styles.small}>Part payment amount</Text>
                  <TextInput
                    style={styles.input}
                    value={prepay}
                    onChangeText={setPrepay}
                    placeholder="e.g. 10000"
                    placeholderTextColor={COLORS.textDim}
                    keyboardType="numeric"
                    accessibilityLabel="Part payment amount"
                  />
                  {preview && 'error' in preview ? (
                    <Text style={styles.error}>{preview.error}</Text>
                  ) : preview ? (
                    <View style={styles.previewBox}>
                      <Text style={styles.previewLine}>
                        EMI {fmtInr(preview.oldEmi)} → <Text style={styles.bold}>{fmtInr(preview.newEmi)}</Text>
                      </Text>
                      {preview.result.day != null && info.day != null && (
                        <Text style={styles.previewLine}>
                          Free-money day {dayLabel(info.year, info.month, Math.max(info.day, 1))} →{' '}
                          <Text style={[styles.bold, { color: COLORS.positive }]}>
                            {preview.result.day === 0 ? 'every day free' : dayLabel(info.year, info.month, preview.result.day)}
                          </Text>
                          {info.day - preview.result.day > 0 ? ` (${info.day - preview.result.day} ${info.day - preview.result.day === 1 ? 'day' : 'days'} earlier)` : ''}
                        </Text>
                      )}
                      <Text style={styles.small}>Preview only. Nothing is paid until you record the part payment on the loan.</Text>
                      <Pressable onPress={() => router.push('/(tabs)/loans')} accessibilityRole="link">
                        <Text style={styles.link}>Go to Loans</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </>
              )}
            </Card>
            <Notice>Each day of the month stands for an equal share of your income, so this is a guide to how much is spoken for, not a bank balance.</Notice>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  container: { padding: SPACING.lg, paddingBottom: SPACING.xl * 2, gap: SPACING.md },
  big: { color: COLORS.text, fontSize: 32, fontWeight: '700', marginBottom: SPACING.xs },
  small: { color: COLORS.textDim, fontSize: 12 },
  muted: { color: COLORS.textMuted, fontSize: 13, marginTop: SPACING.xs },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: SPACING.xs },
  item: { gap: 2, paddingVertical: SPACING.xs },
  itemBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  itemLabel: { color: COLORS.text, fontSize: 14, flexShrink: 1 },
  itemAmount: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: { borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 6 },
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
    marginTop: SPACING.xs,
  },
  previewBox: { gap: 4, marginTop: SPACING.sm },
  previewLine: { color: COLORS.text, fontSize: 14 },
  bold: { fontWeight: '700' },
  error: { color: COLORS.red, fontSize: 13, marginTop: SPACING.xs },
  link: { color: COLORS.accent, fontWeight: '600', fontSize: 13 },
});
