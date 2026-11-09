import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Image, Pressable, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card } from '../../components/Card';
import { Button, ErrorText, Field, Notice, ScreenHeader, Segmented, kit } from '../../components/ScreenKit';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { confirmAction } from '../../utils/alert';
import { apiErrorMessage } from '../../utils/api';
import { AdminClaim, ClaimStatus, confirmPayment, getAdminPayments, getPaymentScreenshot, rejectPayment } from '../../utils/plan';

type Tab = 'pending' | 'confirmed' | 'rejected';
const TABS: { key: Tab; label: string }[] = [
  { key: 'pending', label: 'To confirm' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'rejected', label: 'Rejected' },
];

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const spaced = (id: string) => id.replace(/(.{4})/g, '$1 ').trim();

// An admin checks the money really arrived (bank or UPI app), then confirms here. Confirming
// adds a year after the user's current end date. Only an admin can; support can look.
export default function PaymentsScreen() {
  const { isStaff, canViewMetrics, isAdmin } = useAuth();
  const canView = isStaff || canViewMetrics;
  const [tab, setTab] = useState<Tab>('pending');
  const [claims, setClaims] = useState<AdminClaim[] | null>(null);
  const [price, setPrice] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (which: Tab = tab) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        const r = await getAdminPayments(which as ClaimStatus);
        setClaims(r.claims);
        setPrice(r.price_inr);
      } catch (err) {
        setError(apiErrorMessage(err, 'Could not load payments.'));
      } finally {
        setLoading(false);
      }
    },
    [canView, tab]
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!canView) {
    return (
      <View style={kit.screen}>
        <ScreenHeader title="Payments" />
        <View style={styles.center}>
          <Text style={kit.muted}>Staff access required.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={kit.screen}>
      <ScreenHeader title="Payments to confirm" />
      <ScrollView contentContainerStyle={kit.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} />}>
        <Segmented<Tab>
          options={TABS}
          value={tab}
          onChange={(t) => {
            setTab(t);
            setClaims(null);
            load(t);
          }}
        />
        {!isAdmin && <Notice>You can look at payments, but only an admin can confirm or reject them.</Notice>}
        <ErrorText message={error} />
        {claims && claims.length === 0 && <Text style={kit.muted}>{tab === 'pending' ? 'Nothing is waiting. All payments are confirmed.' : 'Nothing here yet.'}</Text>}
        {claims?.map((c) => (
          <ClaimCard key={c.id} claim={c} price={price} isAdmin={isAdmin} onChanged={() => load()} />
        ))}
        <View style={{ height: SPACING.lg }} />
      </ScrollView>
    </View>
  );
}

const ClaimCard: React.FC<{ claim: AdminClaim; price: number; isAdmin: boolean; onChanged: () => void }> = ({ claim, price, isAdmin, onChanged }) => {
  const [shot, setShot] = useState<string | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(price));
  const [reason, setReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = claim.status === 'pending';

  const showShot = async () => {
    setShotError(null);
    try {
      setShot(await getPaymentScreenshot(claim.id));
    } catch (err) {
      setShotError(apiErrorMessage(err, 'No screenshot to show.'));
    }
  };

  const onConfirm = () => {
    setError(null);
    const value = Number(amount);
    if (!(value >= price)) return setError(`The amount can't be below the plan price of ₹${price}.`);
    confirmAction('Confirm payment received', `You have checked that ₹${value} with transaction ${spaced(claim.txnId)} reached the account. This adds a year for ${claim.email}.`, 'Confirm received', async () => {
      setBusy(true);
      try {
        await confirmPayment(claim.id, value);
        onChanged();
      } catch (err) {
        setError(apiErrorMessage(err, 'Could not confirm.'));
      } finally {
        setBusy(false);
      }
    });
  };

  const onReject = async (resend: boolean) => {
    setError(null);
    setBusy(true);
    try {
      await rejectPayment(claim.id, reason.trim(), resend);
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not update this payment.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.top}>
        <Text style={styles.email}>{claim.email}</Text>
        <Text style={[styles.status, claim.status === 'confirmed' && { color: COLORS.positive }, claim.status === 'rejected' && { color: COLORS.red }]}>
          {pending ? 'Waiting' : claim.status === 'confirmed' ? 'Confirmed' : claim.status === 'rejected' ? 'Rejected' : 'Cancelled'}
        </Text>
      </View>
      <Text style={kit.muted}>
        {claim.name} · sent {when(claim.createdAt)}
        {claim.source === 'admin' ? ' · recorded by an admin' : ''}
      </Text>
      <Row label="Transaction ID" value={spaced(claim.txnId)} />
      <Row label="Expected amount" value={`₹${price}`} />
      {claim.amountInr != null && <Row label="Amount received" value={`₹${claim.amountInr}`} />}
      <Row label="Used before" value={claim.usedBefore === 0 ? 'Never' : `${claim.usedBefore} earlier payment${claim.usedBefore === 1 ? '' : 's'} used this ID`} warn={claim.usedBefore > 0} />
      {claim.note ? <Text style={kit.dim}>Their note: {claim.note}</Text> : null}
      {claim.reason ? <Text style={kit.dim}>Note: {claim.reason}</Text> : null}
      {pending && claim.graceUntil && <Text style={kit.dim}>Holding their access until {when(claim.graceUntil)}.</Text>}

      {claim.hasScreenshot && isAdmin && (shot ? <Image source={{ uri: shot }} style={styles.shot} resizeMode="contain" /> : <Button label="Show screenshot" variant="outline" onPress={showShot} />)}
      {shotError && <Text style={kit.dim}>{shotError}</Text>}
      {!claim.hasScreenshot && claim.source === 'user' && <Text style={kit.dim}>The screenshot was removed 30 days after this was decided.</Text>}

      {pending && isAdmin && (
        <>
          <Field label="Amount received (₹)" value={amount} onChangeText={setAmount} keyboardType="numeric" />
          <ErrorText message={error} />
          <Button label={busy ? 'Working…' : 'Confirm received'} onPress={onConfirm} disabled={busy} />
          {showReject ? (
            <>
              <Field label="Reason (the user sees this)" value={reason} onChangeText={setReason} placeholder="e.g. Not found in the bank record" />
              <Button label="Ask to send again" variant="outline" onPress={() => onReject(true)} disabled={busy} />
              <Button label="Reject" variant="danger" onPress={() => onReject(false)} disabled={busy} />
            </>
          ) : (
            <Button label="Reject or ask to resend" variant="outline" onPress={() => setShowReject(true)} disabled={busy} />
          )}
        </>
      )}
    </Card>
  );
};

const Row: React.FC<{ label: string; value: string; warn?: boolean }> = ({ label, value, warn }) => (
  <View style={styles.row}>
    <Text style={kit.muted}>{label}</Text>
    <Text style={[styles.value, warn && { color: COLORS.red }]}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { gap: SPACING.xs },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.sm },
  email: { color: COLORS.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  status: { color: COLORS.yellow, fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.sm },
  value: { color: COLORS.text, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  shot: { width: '100%', height: 320, backgroundColor: COLORS.cardBorder, borderRadius: RADIUS.md, marginTop: SPACING.xs },
});
