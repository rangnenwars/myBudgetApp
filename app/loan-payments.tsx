import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Card } from '../components/Card';
import { ScreenHeader, kit } from '../components/ScreenKit';
import { COLORS, SPACING } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { confirmAction } from '../utils/alert';
import { apiErrorMessage } from '../utils/api';
import { deleteLoanPayment, getLoanPayments, LoanPayment } from '../utils/database';
import { fmtAmount, shortDate } from '../utils/people';

const KIND_LABEL: Record<LoanPayment['kind'], string> = { part_payment: 'Part payment', emi: 'EMI' };

// One loan's payment history, newest first: part payments and EMIs, each with
// the balance left afterwards (blank for part payments recovered from old
// transactions, where the balance at the time isn't known).
export default function LoanPaymentsScreen() {
  const { user, isLoading } = useAuth();
  const { id: idParam, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const id = Number(idParam);
  const [rows, setRows] = useState<LoanPayment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => getLoanPayments(id).then((r) => setRows(r)), [id]);

  // Permanent: the balance, the EMI and the expense entry it logged all go back.
  const remove = (p: LoanPayment) =>
    confirmAction('Delete part payment', `Delete the ${fmtAmount(p.amount)} part payment of ${shortDate(p.date)}? The balance, the EMI and its expense entry go back. This cannot be undone.`, 'Delete', async () => {
      setError(null);
      try {
        await deleteLoanPayment(id, p.id);
        await reload();
      } catch (err) {
        setError(apiErrorMessage(err, 'Could not delete this payment.'));
      }
    });

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getLoanPayments(id)
        .then((r) => {
          if (!active) return;
          setRows(r);
          setFailed(false);
        })
        .catch(() => active && setFailed(true));
      return () => {
        active = false;
      };
    }, [id])
  );

  if (isLoading) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    <View style={kit.screen}>
      <ScreenHeader title={name ? `${name} · payments` : 'Payments'} />
      <ScrollView contentContainerStyle={kit.content}>
        <Text style={kit.dim}>Part payments and EMIs, newest first.</Text>
        {error && <Text style={styles.error}>{error}</Text>}
        {failed ? (
          <Text style={kit.muted}>Could not load the payments. Pull back and try again.</Text>
        ) : rows == null ? (
          <ActivityIndicator color={COLORS.accent} />
        ) : rows.length === 0 ? (
          <Text style={kit.muted}>No payments recorded yet.</Text>
        ) : (
          <Card>
            {rows.map((p, i) => (
              <View key={p.id} style={[styles.row, i !== 0 && styles.rowBorder]}>
                <View style={styles.rowText}>
                  <Text style={styles.kind}>{KIND_LABEL[p.kind]}</Text>
                  <Text style={styles.meta}>
                    {shortDate(p.date)}
                    {p.balance_after != null ? ` · balance after ${fmtAmount(p.balance_after)}` : ''}
                  </Text>
                </View>
                <Text style={styles.amount}>{fmtAmount(p.amount)}</Text>
                {p.kind === 'part_payment' && (
                  <Pressable onPress={() => remove(p)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete part payment of ${fmtAmount(p.amount)}`}>
                    <Ionicons name="trash-outline" size={18} color={COLORS.red} />
                  </Pressable>
                )}
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.sm, gap: SPACING.md },
  rowBorder: { borderTopColor: COLORS.cardBorder, borderTopWidth: 1 },
  rowText: { flex: 1 },
  kind: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  meta: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  amount: { color: COLORS.text, fontSize: 14, fontWeight: '600', flexShrink: 0 },
  error: { color: COLORS.red, fontSize: 13 },
});
