import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable, ActivityIndicator, Linking, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { Card } from '../components/Card';
import { Button, ErrorText, Field, Notice, ScreenHeader, SectionTitle, kit } from '../components/ScreenKit';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage } from '../utils/api';
import { cancelClaim, getMyPlan, getPaymentDetails, submitClaim, MyPlan, PaymentDetails } from '../utils/plan';
import { PickedImage, formatBytes, pickImage } from '../utils/pickImage';
import { canRenew, priceText, shortDate } from '../utils/planState';

const MAX_SHOT = 2 * 1024 * 1024;

// Pay by QR or UPI ID, then tell us. Step 1 shows the details an admin set; step 2
// sends the transaction ID and a screenshot, which an admin checks against the
// money received. Until then the user is told it is being checked, and nothing is locked.
export default function RenewScreen() {
  const { user, reloadUser } = useAuth();
  const [plan, setPlan] = useState<MyPlan | null>(null);
  const [details, setDetails] = useState<PaymentDetails | null>(null);
  const [failed, setFailed] = useState(false);
  const [shot, setShot] = useState<PickedImage | null>(null);
  const [txn, setTxn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [openHint, setOpenHint] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, d] = await Promise.all([getMyPlan(), getPaymentDetails()]);
      setPlan(p);
      setDetails(d);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      load();
      reloadUser().catch(() => {});
    }, [user?.id, load, reloadUser])
  );

  if (!plan || !details) {
    return (
      <View style={kit.screen}>
        <ScreenHeader title="Renew" />
        <View style={styles.center}>{failed ? <Text style={kit.muted}>Could not load this. Go back and try again.</Text> : <ActivityIndicator color={COLORS.accent} />}</View>
      </View>
    );
  }

  if (!canRenew(plan.plan)) {
    return (
      <View style={kit.screen}>
        <ScreenHeader title="Renew" />
        <View style={styles.center}>
          <Text style={kit.muted}>{plan.plan.state === 'company' ? "Company accounts don't need to pay." : 'There is nothing to renew yet.'}</Text>
        </View>
      </View>
    );
  }

  const pending = plan.claims.find((c) => c.status === 'pending');
  const startsFrom = plan.plan.until && (plan.plan.state === 'trial' || plan.plan.state === 'paid') ? shortDate(plan.plan.until) : 'today';

  const onPick = async () => {
    setError(null);
    const res = await pickImage({ allowed: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: MAX_SHOT, what: 'screenshot' });
    if (res.ok) setShot(res.image);
    else if ('error' in res) setError(res.error);
  };

  const onSubmit = async () => {
    setError(null);
    if (!shot) return setError('Add a screenshot of your payment.');
    if (txn.replace(/[\s-]/g, '').length < 8) return setError('Enter the transaction ID from your UPI app. It is usually 12 digits.');
    setBusy(true);
    try {
      await submitClaim({ txn_id: txn, screenshot: shot.data });
      setShot(null);
      setTxn('');
      await load();
      reloadUser().catch(() => {});
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not send your payment details. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await cancelClaim(pending.id);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not cancel. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async (text: string) => {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onOpenUpi = async (link: string) => {
    setOpenHint(false);
    try {
      await Linking.openURL(link);
    } catch {
      setOpenHint(true);
    }
    // On a computer there is usually no UPI app to open: point at the QR instead.
    if (Platform.OS === 'web') setOpenHint(true);
  };

  return (
    <View style={kit.screen}>
      <ScreenHeader title="Renew Prapanji Pro" />
      <ScrollView contentContainerStyle={kit.content} keyboardShouldPersistTaps="handled">
        <Card style={styles.price}>
          <Text style={styles.priceBig}>{priceText(plan.plan)}</Text>
          <Text style={kit.muted}>Adds a year from {startsFrom}. Unused time is never lost.</Text>
        </Card>

        {pending ? (
          <>
            <Notice tone="warning">
              We're checking your payment. This usually takes a few hours and at most one working day. Everything keeps working while we check, and we'll email you when it's done.
            </Notice>
            <Card style={styles.pendingCard}>
              <Row label="Amount" value={priceText(plan.plan).replace(/ a (year|month)$/, '')} />
              <Row label="Transaction ID" value={pending.txn_id} />
              <Row label="Sent" value={new Date(pending.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} />
            </Card>
            <Text style={kit.dim}>Sent the wrong ID or screenshot? Cancel this and send it again.</Text>
            <ErrorText message={error} />
            <Button label="Cancel and send again" variant="outline" onPress={onCancel} disabled={busy} />
          </>
        ) : !details.configured ? (
          <Notice tone="warning">Payments are not set up yet. Please contact support and we will help you renew.</Notice>
        ) : (
          <>
            {plan.claims[0]?.status === 'rejected' && (
              <Notice tone="warning">
                {plan.claims[0].asked_to_resend
                  ? `Please send your payment details again${plan.claims[0].reason ? `. Note: ${plan.claims[0].reason}` : ''}.`
                  : `Your last payment couldn't be confirmed${plan.claims[0].reason ? `: ${plan.claims[0].reason}` : ''}. If you paid, contact support with your transaction ID.`}
              </Notice>
            )}

            <SectionTitle>Step 1: pay</SectionTitle>
            <Card style={styles.payCard}>
              <Image source={{ uri: details.qr }} style={styles.qr} resizeMode="contain" accessibilityLabel={`QR code to pay ${details.payee_name}`} />
              <Text style={styles.payee}>{details.payee_name}</Text>
              <View style={styles.upiRow}>
                <Text style={styles.upi} selectable>
                  {details.upi_id}
                </Text>
                <Pressable onPress={() => onCopy(details.upi_id)} style={styles.copyBtn} accessibilityRole="button" accessibilityLabel="Copy UPI ID">
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={COLORS.accent} />
                  <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
                </Pressable>
              </View>
              <Button label={`Open my UPI app (₹${details.amount_inr.toLocaleString('en-IN')})`} onPress={() => onOpenUpi(details.upi_link)} />
              {openHint && <Text style={kit.dim}>Can't open a UPI app here? Scan the QR from your phone, or pay to the UPI ID above.</Text>}
              <Text style={kit.dim}>Pay exactly ₹{details.amount_inr.toLocaleString('en-IN')}, and put your account email ({user?.email}) in the note.</Text>
            </Card>

            <SectionTitle>Step 2: tell us you paid</SectionTitle>
            <Card style={styles.payCard}>
              {shot ? (
                <View style={styles.shotRow}>
                  <Image source={{ uri: shot.uri }} style={styles.shotThumb} resizeMode="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={kit.muted}>
                      {shot.mimeType.replace('image/', '').toUpperCase()} · {formatBytes(shot.bytes)}
                    </Text>
                    <Pressable onPress={() => setShot(null)} hitSlop={8}>
                      <Text style={styles.remove}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Button label="Add a screenshot of the payment" variant="outline" onPress={onPick} />
              )}
              <Text style={kit.dim}>PNG, JPG or WebP, up to 2 MB. Only you and the app's administrators can open it, and it is deleted 30 days after we confirm.</Text>
              <Field
                label="Transaction ID (UTR)"
                value={txn}
                onChangeText={setTxn}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="e.g. 4021 8837 1190"
                hint="Find it in your UPI app under the payment details. It is usually 12 digits."
              />
              <ErrorText message={error} />
              <Button label={busy ? 'Sending…' : 'I have paid'} onPress={onSubmit} disabled={busy} />
            </Card>
          </>
        )}
        <View style={{ height: SPACING.lg }} />
      </ScrollView>
    </View>
  );
}

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={kit.muted}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  price: { gap: SPACING.xs },
  priceBig: { color: COLORS.text, fontSize: 24, fontWeight: '700' },
  payCard: { gap: SPACING.sm },
  qr: { width: 220, height: 220, alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: RADIUS.md },
  payee: { color: COLORS.text, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  upiRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.md },
  upi: { color: COLORS.text, fontSize: 15 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderColor: COLORS.accent, borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 4 },
  copyText: { color: COLORS.accent, fontSize: 12, fontWeight: '600' },
  pendingCard: { gap: SPACING.xs },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  infoValue: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  shotRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  shotThumb: { width: 64, height: 64, borderRadius: RADIUS.sm, backgroundColor: COLORS.cardBorder },
  remove: { color: COLORS.red, fontSize: 13, fontWeight: '600', marginTop: 4 },
});
