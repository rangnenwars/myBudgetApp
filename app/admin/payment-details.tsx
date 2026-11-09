import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Image, Pressable } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card } from '../../components/Card';
import { Button, ErrorText, Field, Notice, ScreenHeader, SectionTitle, kit } from '../../components/ScreenKit';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { apiErrorMessage } from '../../utils/api';
import { AdminPaymentDetails, getAdminPaymentDetails, saveAdminPaymentDetails } from '../../utils/plan';
import { PickedImage, formatBytes, pickImage } from '../../utils/pickImage';

const UPI_RE = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.-]{1,40}$/;

// The QR code and UPI ID every user sees on the Renew screen. The server reads the QR and
// refuses it unless it pays the UPI ID typed here, then asks for the password and emails
// every admin, so a swapped QR can't go unnoticed (server: routes/adminPlan.ts).
export default function PaymentDetailsScreen() {
  const { isStaff, canViewMetrics, isAdmin } = useAuth();
  const canView = isStaff || canViewMetrics;
  const [current, setCurrent] = useState<AdminPaymentDetails | null>(null);
  const [upi, setUpi] = useState('');
  const [name, setName] = useState('');
  const [qr, setQr] = useState<PickedImage | null>(null);
  const [password, setPassword] = useState('');
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!canView) return;
    try {
      const d = await getAdminPaymentDetails();
      setCurrent(d);
      if (d.configured) {
        setUpi(d.upi_id ?? '');
        setName(d.payee_name ?? '');
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load the payment details.'));
    }
  }, [canView]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onPick = async () => {
    setError(null);
    setNeedsConfirm(false);
    setConfirmed(false);
    // No compression: a squashed QR may stop being readable.
    const res = await pickImage({ allowed: ['image/png', 'image/jpeg'], maxBytes: 1024 * 1024, what: 'QR image', quality: 1 });
    if (res.ok) setQr(res.image);
    else if ('error' in res) setError(res.error);
  };

  const onSave = async () => {
    setError(null);
    setSaved(false);
    if (!UPI_RE.test(upi.trim())) return setError('Enter a valid UPI ID, like name@bank.');
    if (name.trim().length < 2) return setError('Enter the name to show to users.');
    if (!qr) return setError('Upload your UPI QR code.');
    if (!password) return setError('Enter your password to save.');
    setBusy(true);
    try {
      await saveAdminPaymentDetails({ upi_id: upi.trim(), payee_name: name.trim(), qr: qr.data, password, confirm_unreadable: needsConfirm && confirmed });
      setSaved(true);
      setPassword('');
      setNeedsConfirm(false);
      setConfirmed(false);
      setQr(null);
      await load();
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } }).response?.data?.code;
      if (code === 'QR_UNREADABLE') setNeedsConfirm(true);
      setError(apiErrorMessage(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  if (!canView) {
    return (
      <View style={kit.screen}>
        <ScreenHeader title="Payment details" />
        <View style={styles.center}>
          <Text style={kit.muted}>Staff access required.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={kit.screen}>
      <ScreenHeader title="Payment details" />
      <ScrollView contentContainerStyle={kit.content} keyboardShouldPersistTaps="handled">
        {!isAdmin && <Notice>You can look at these, but only an admin can change them.</Notice>}

        <SectionTitle>What users see now</SectionTitle>
        <Card style={styles.shown}>
          {current?.configured ? (
            <>
              <Image source={{ uri: current.qr }} style={styles.qr} resizeMode="contain" accessibilityLabel="Current payment QR code" />
              <Text style={styles.payee}>{current.payee_name}</Text>
              <Text style={kit.muted}>{current.upi_id}</Text>
              {current.qr_verified === false && <Text style={styles.warn}>This QR could not be read, so it was confirmed by hand.</Text>}
              {current.updated_at && (
                <Text style={kit.dim}>
                  Last changed {new Date(current.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {current.updated_by ? ` by ${current.updated_by}` : ''}
                </Text>
              )}
            </>
          ) : (
            <Text style={kit.muted}>Nothing is set up yet, so users can't pay. Add your UPI QR code below.</Text>
          )}
        </Card>

        {isAdmin && (
          <>
            <SectionTitle>Change them</SectionTitle>
            <Card style={styles.form}>
              {qr ? (
                <View style={styles.pickedRow}>
                  <Image source={{ uri: qr.uri }} style={styles.thumb} resizeMode="contain" />
                  <View style={{ flex: 1 }}>
                    <Text style={kit.muted}>
                      {qr.mimeType.replace('image/', '').toUpperCase()} · {formatBytes(qr.bytes)}
                    </Text>
                    <Pressable onPress={() => setQr(null)} hitSlop={8}>
                      <Text style={styles.remove}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Button label="Upload your UPI QR code" variant="outline" onPress={onPick} />
              )}
              <Text style={kit.dim}>PNG or JPG, up to 1 MB. Use the original image from your UPI app, not a photo of a screen.</Text>
              <Field label="UPI ID (checked against the QR)" value={upi} onChangeText={setUpi} autoCapitalize="none" autoCorrect={false} placeholder="name@bank" />
              <Field label="Name shown to users" value={name} onChangeText={setName} placeholder="Prapanji" />
              <Field label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" hint="Saving asks for your password, and every admin is emailed that the payment details changed." />

              {needsConfirm && (
                <Pressable style={styles.confirmRow} onPress={() => setConfirmed((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }}>
                  <View style={[styles.box, confirmed && styles.boxOn]}>
                    <Text style={styles.tick}>{confirmed ? '✓' : ''}</Text>
                  </View>
                  <Text style={styles.confirmText}>I have checked that this QR pays {upi.trim() || 'this UPI ID'}.</Text>
                </Pressable>
              )}

              <ErrorText message={error} />
              {saved && <Text style={styles.saved}>Saved. Every admin has been emailed.</Text>}
              <Button label={busy ? 'Saving…' : 'Save payment details'} onPress={onSave} disabled={busy || (needsConfirm && !confirmed)} />
            </Card>
          </>
        )}
        <View style={{ height: SPACING.lg }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  shown: { gap: SPACING.xs, alignItems: 'center' },
  qr: { width: 200, height: 200, backgroundColor: '#FFFFFF', borderRadius: RADIUS.md },
  payee: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  warn: { color: COLORS.yellow, fontSize: 12.5, textAlign: 'center' },
  form: { gap: SPACING.sm },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  thumb: { width: 72, height: 72, backgroundColor: '#FFFFFF', borderRadius: RADIUS.sm },
  remove: { color: COLORS.red, fontSize: 13, fontWeight: '600', marginTop: 4 },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  box: { width: 22, height: 22, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  tick: { color: COLORS.onAccent, fontSize: 13, fontWeight: '700' },
  confirmText: { flex: 1, color: COLORS.text, fontSize: 13 },
  saved: { color: COLORS.positive, fontSize: 13, fontWeight: '600' },
});
