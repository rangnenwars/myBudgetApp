import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../constants/theme';
import { priceLabel } from '../constants/features';
import { apiErrorMessage } from '../utils/api';
import { MyFeature, requestFeature } from '../utils/database';
import { ErrorText } from './ScreenKit';
import { useAuth } from '../context/AuthContext';

interface Props {
  feature: MyFeature | null;
  onClose: () => void;
  /** Called with the feature once the request is sent. */
  onSent: (feature: MyFeature) => void;
}

/**
 * Asks staff to switch a feature on. A priced feature first tells the user how
 * to pay (UPI, with their email in the note); staff check the payment and
 * switch it on from the admin Waiting requests list. A free one just asks.
 */
export const FeatureRequestSheet: React.FC<Props> = ({ feature, onClose, onSent }) => {
  const { user } = useAuth();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSending(false);
    setError(null);
  }, [feature?.key]);

  if (!feature) return null;
  const priced = feature.price > 0;

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      onSent(await requestFeature(feature.key, priced));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not send the request. Try again.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible transparent animationType={MODAL_ANIMATION} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{priced ? `${feature.label} · ${priceLabel(feature.price, feature.period)}` : feature.label}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </Pressable>
          </View>
          <Text style={styles.hint}>{priced ? 'Your admin switches it on after your payment.' : 'Your admin will switch it on for your account.'}</Text>

          {priced &&
            (feature.upiId ? (
              <View style={styles.steps}>
                <Text style={styles.step}>
                  <Text style={styles.bold}>1.</Text> Pay ₹{feature.price} by UPI to <Text style={styles.bold}>{feature.upiId}</Text>
                </Text>
                <Text style={styles.step}>
                  <Text style={styles.bold}>2.</Text> Put your email{user?.email ? ` (${user.email})` : ''} in the payment note
                </Text>
                <Text style={styles.step}>
                  <Text style={styles.bold}>3.</Text> Tap the button below
                </Text>
              </View>
            ) : (
              <Text style={styles.step}>Ask your admin how to pay ₹{feature.price}, then tap the button below.</Text>
            ))}

          <ErrorText message={error} />
          <Pressable style={[styles.save, sending && { opacity: 0.6 }]} onPress={send} disabled={sending} accessibilityRole="button">
            <Text style={styles.saveText}>{sending ? 'Sending…' : priced ? "I've paid, send request" : 'Request access'}</Text>
          </Pressable>
          <Pressable onPress={onClose} accessibilityRole="button" style={styles.later}>
            <Text style={styles.laterText}>Not now</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'flex-end' },
  scroll: { maxHeight: '94%' },
  sheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  hint: { color: COLORS.textMuted, fontSize: 13 },
  steps: { gap: SPACING.xs, marginVertical: SPACING.xs },
  step: { color: COLORS.text, fontSize: 14, lineHeight: 21 },
  bold: { fontWeight: '700' },
  save: { backgroundColor: COLORS.accent, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center', marginTop: SPACING.xs },
  saveText: { color: COLORS.onAccent, fontWeight: '700', fontSize: 15 },
  later: { alignItems: 'center', paddingVertical: SPACING.xs },
  laterText: { color: COLORS.textMuted, fontSize: 14 },
});
