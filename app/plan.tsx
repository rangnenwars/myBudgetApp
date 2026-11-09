import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { Card } from '../components/Card';
import { Button, Notice, ScreenHeader, SectionTitle, kit } from '../components/ScreenKit';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { FEATURES } from '../constants/features';
import { useAuth } from '../context/AuthContext';
import { getMyPlan, MyClaim, MyPlan } from '../utils/plan';
import { canRenew, planHeadline, priceText, shortDate } from '../utils/planState';

const ALWAYS_FREE = 'Home, Transactions, Budgets, Accounts, People and the monthly and category reports are always free.';

/** The line about the user's latest payment, in plain words. */
const claimMessage = (c: MyClaim): { text: string; tone: 'info' | 'warning' | 'success' } | null => {
  if (c.status === 'pending') return { text: "We're checking your payment. This usually takes a few hours and at most one working day. Everything keeps working while we check, and we'll email you.", tone: 'warning' };
  if (c.status === 'confirmed') return { text: 'Your last payment was confirmed. Thank you.', tone: 'success' };
  if (c.status === 'rejected') {
    return {
      text: c.asked_to_resend
        ? `We couldn't read or match your payment details${c.reason ? ` (${c.reason})` : ''}. Please send the screenshot and transaction ID again.`
        : `We couldn't confirm your last payment${c.reason ? `: ${c.reason}` : ''}. If you paid, please contact support with your transaction ID.`,
      tone: 'warning',
    };
  }
  return null;
};

export default function PlanScreen() {
  const { user, reloadUser } = useAuth();
  const [data, setData] = useState<MyPlan | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      reloadUser().catch(() => {});
      getMyPlan()
        .then((r) => active && (setData(r), setFailed(false)))
        .catch(() => active && setFailed(true));
      return () => {
        active = false;
      };
    }, [user?.id, reloadUser])
  );

  const plan = data?.plan ?? user?.plan;
  if (!plan) {
    return (
      <View style={kit.screen}>
        <ScreenHeader title="Your plan" />
        <View style={styles.center}>{failed ? <Text style={kit.muted}>Could not load this. Go back and try again.</Text> : <ActivityIndicator color={COLORS.accent} />}</View>
      </View>
    );
  }

  const head = planHeadline(plan);
  const latest = data?.claims[0];
  const message = latest ? claimMessage(latest) : null;
  const waiting = data?.claims.some((c) => c.status === 'pending') ?? false;
  const tone = plan.state === 'none' ? COLORS.red : plan.state === 'grace' ? COLORS.yellow : COLORS.accent;
  const included = new Set(plan.features);
  const hasPlan = plan.state !== 'none';

  return (
    <View style={kit.screen}>
      <ScreenHeader title="Your plan" />
      <ScrollView contentContainerStyle={kit.content}>
        <Card style={[styles.head, { borderColor: `${tone}66` }]}>
          <Text style={[styles.headTitle, { color: tone }]}>{head.title}</Text>
          <Text style={kit.muted}>{head.detail}</Text>
        </Card>

        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        <SectionTitle>What is included</SectionTitle>
        <Card style={styles.list}>
          {FEATURES.map((f, i) => {
            const on = hasPlan && included.has(f.key);
            return <Row key={f.key} label={f.label} on={on} first={i === 0} />;
          })}
          <Row label="Pro insights and trends" on={hasPlan} first={false} />
        </Card>
        <Text style={kit.dim}>{ALWAYS_FREE}</Text>

        {plan.state !== 'company' && (
          <Text style={kit.muted}>
            {plan.state === 'trial' && plan.until
              ? `After ${shortDate(plan.until)}, keeping these is ${priceText(plan)}.`
              : `Keeping these is ${priceText(plan)}.`}
          </Text>
        )}

        {canRenew(plan) && !waiting && (
          <Button label={plan.state === 'trial' || plan.state === 'paid' ? `Renew early · ${priceText(plan)}` : `Renew · ${priceText(plan)}`} onPress={() => router.push('/renew')} />
        )}
        {waiting && <Button label="See my payment" variant="outline" onPress={() => router.push('/renew')} />}
        {!plan.enforced && <Text style={kit.dim}>Nothing is switched off yet. This is what will apply once the plan starts.</Text>}
        <View style={{ height: SPACING.lg }} />
      </ScrollView>
    </View>
  );
}

const Row: React.FC<{ label: string; on: boolean; first: boolean }> = ({ label, on, first }) => (
  <View style={[styles.row, !first && styles.rowBorder]}>
    <Text style={[styles.rowLabel, !on && { color: COLORS.textDim }]}>{label}</Text>
    <View style={styles.rowRight}>
      <Ionicons name={on ? 'checkmark-circle' : 'lock-closed-outline'} size={16} color={on ? COLORS.positive : COLORS.textDim} />
      <Text style={[styles.rowState, { color: on ? COLORS.positive : COLORS.textDim }]}>{on ? 'Included' : 'Paused'}</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  head: { gap: SPACING.xs, borderWidth: 1 },
  headTitle: { fontSize: 22, fontWeight: '700' },
  list: { padding: 0, overflow: 'hidden', borderRadius: RADIUS.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 12 },
  rowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  rowLabel: { color: COLORS.text, fontSize: 14 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowState: { fontSize: 12, fontWeight: '600' },
});
