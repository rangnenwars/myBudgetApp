import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Button, ErrorText, Field, Segmented } from '../ScreenKit';
import { ExceptionEditor } from './ExceptionEditor';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { apiErrorMessage } from '../../utils/api';
import { getAdminPlan, getUserAccess, markPaymentReceived, setAccountKind, UserAccess } from '../../utils/plan';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const STATE_TEXT: Record<UserAccess['access']['state'], string> = {
  company: 'Company account: always has access',
  exception: 'Exception: full access',
  paid: 'Paid',
  trial: 'Free trial',
  grace: 'Payment being checked',
  none: 'No access',
};

interface Props {
  userId: number;
  isAdmin: boolean;
  isSelf: boolean;
}

/** The access part of the admin user sheet: account type, where they stand, the exception, and recording a payment. */
export const UserAccessSection: React.FC<Props> = ({ userId, isAdmin, isSelf }) => {
  const [data, setData] = useState<UserAccess | null>(null);
  const [price, setPrice] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState('');
  const [txn, setTxn] = useState('');
  const [recordedUntil, setRecordedUntil] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getUserAccess(userId));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not load this account's access."));
    }
  }, [userId]);

  useEffect(() => {
    setData(null);
    setRecordedUntil(null);
    setPaying(false);
    load();
    getAdminPlan()
      .then((o) => {
        setPrice(o.plan.price_inr);
        setAmount(String(o.plan.price_inr));
      })
      .catch(() => {});
  }, [userId, load]);

  const onKind = async (kind: 'customer' | 'company') => {
    setBusy(true);
    setError(null);
    try {
      await setAccountKind(userId, kind);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not change the account type.'));
    } finally {
      setBusy(false);
    }
  };

  const onPayment = async () => {
    setError(null);
    const value = Number(amount);
    if (!(value >= price)) return setError(`The amount can't be below the plan price of ₹${price}.`);
    if (txn.replace(/[\s-]/g, '').length < 8) return setError('Enter the transaction ID or a reference, at least 8 letters or digits.');
    setBusy(true);
    try {
      const r = await markPaymentReceived(userId, { amount_inr: value, txn_id: txn });
      setRecordedUntil(fmt(r.access_until));
      setTxn('');
      setPaying(false);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not record the payment.'));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <Text style={styles.dim}>{error ?? 'Loading access…'}</Text>;
  const a = data.access;
  const company = data.account_kind === 'company';

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Plan and access</Text>
      <Text style={styles.label}>Account type</Text>
      <Segmented<'customer' | 'company'>
        options={[
          { key: 'customer', label: 'Customer' },
          { key: 'company', label: 'Company' },
        ]}
        value={data.account_kind}
        onChange={isAdmin && !isSelf && !busy ? onKind : () => {}}
      />
      <Text style={styles.dim}>
        {company
          ? 'Company accounts (staff, testers) never expire, are never charged, and are left out of customer counts and reminders.'
          : isSelf
            ? 'You cannot change your own account type.'
            : 'Customers get the free period, then pay.'}
      </Text>

      <View style={styles.state}>
        <Text style={styles.stateTitle}>{STATE_TEXT[a.state]}</Text>
        <Text style={styles.dim}>
          {a.state === 'none' && a.ended_on
            ? `Ended ${fmt(a.ended_on)}`
            : a.until
              ? `Until ${fmt(a.until)}${a.days_left != null ? ` · ${a.days_left} days left` : ''}`
              : company || a.state === 'exception'
                ? 'No end date'
                : ''}
        </Text>
        {data.pending_claims > 0 && (
          <Pressable onPress={() => router.push('/admin/payments')} accessibilityRole="link">
            <Text style={styles.link}>{data.pending_claims} payment waiting to be confirmed ›</Text>
          </Pressable>
        )}
      </View>

      {!company && <ExceptionEditor key={`${userId}-${data.exception?.since ?? 'none'}`} userId={userId} current={data.exception} onChanged={load} canEdit={isAdmin} />}

      {!company && isAdmin && (
        <>
          {paying ? (
            <View style={styles.pay}>
              <Field label="Amount received (₹)" value={amount} onChangeText={setAmount} keyboardType="numeric" />
              <Field label="Transaction ID or reference" value={txn} onChangeText={setTxn} autoCapitalize="characters" autoCorrect={false} hint="Each ID can be used once. Adds a year after their current end date." />
              <Button label={busy ? 'Saving…' : 'Mark payment received'} onPress={onPayment} disabled={busy} />
              <Button label="Cancel" variant="outline" onPress={() => setPaying(false)} />
            </View>
          ) : (
            <Button label="Record a payment received" variant="outline" onPress={() => setPaying(true)} />
          )}
          {recordedUntil && <Text style={styles.ok}>Payment recorded. Access now runs to {recordedUntil}.</Text>}
        </>
      )}
      <ErrorText message={error} />

      <Text style={styles.label}>History</Text>
      {data.grants.map((g) => (
        <Text key={g.id} style={[styles.dim, g.revokedAt ? styles.struck : null]}>
          {g.kind === 'trial' ? 'Free trial' : g.kind === 'paid' ? `Paid ₹${g.amountInr ?? ''}` : `Exception${g.reason ? `: ${g.reason}` : ''}`} · {fmt(g.startsAt)} to {g.endsAt ? fmt(g.endsAt) : 'no end'}
          {g.revokedAt ? ' · removed' : ''}
          {g.by ? ` · by ${g.by}` : ''}
        </Text>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: SPACING.sm, marginTop: SPACING.md },
  heading: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  label: { color: COLORS.textMuted, fontSize: 13 },
  dim: { color: COLORS.textDim, fontSize: 12 },
  struck: { textDecorationLine: 'line-through' },
  state: { borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.md, padding: SPACING.md, gap: 2 },
  stateTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  link: { color: COLORS.accent, fontSize: 13, fontWeight: '600', marginTop: 4 },
  pay: { gap: SPACING.sm },
  ok: { color: COLORS.positive, fontSize: 13, fontWeight: '600' },
});
