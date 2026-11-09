import React, { useCallback, useState } from 'react';
import { Text, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { getMyPlan } from '../utils/plan';
import { planBanner } from '../utils/planState';

/**
 * Home's one-line plan notice: the free period or plan is ending, it has ended,
 * or a payment is being checked. Shown only once the plan is enforced, and only
 * when there is something to say; tapping opens Your plan.
 */
export const PlanStrip: React.FC = () => {
  const { user } = useAuth();
  const plan = user?.plan;
  const [paying, setPaying] = useState(false);
  const worthChecking = !!plan?.enforced && plan.state !== 'company';

  // A payment of theirs may be waiting even when they have plenty of time left (renewing early).
  useFocusEffect(
    useCallback(() => {
      if (!user || !worthChecking) return;
      let active = true;
      getMyPlan()
        .then((r) => active && setPaying(r.claims.some((c) => c.status === 'pending')))
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [user?.id, worthChecking, plan?.state])
  );

  const banner = planBanner(plan, paying);
  if (!banner) return null;
  const tone = banner.kind === 'ended' ? COLORS.red : banner.kind === 'hold' ? COLORS.accent : COLORS.yellow;
  const icon = banner.kind === 'ended' ? 'lock-closed-outline' : banner.kind === 'hold' ? 'time-outline' : 'alert-circle-outline';

  return (
    <Pressable style={[styles.strip, { borderColor: `${tone}66` }]} onPress={() => router.push('/plan')} accessibilityRole="button" accessibilityLabel={banner.text}>
      <Ionicons name={icon} size={18} color={tone} />
      <Text style={styles.text} numberOfLines={3}>
        {banner.text}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.sm, backgroundColor: COLORS.card },
  text: { flex: 1, color: COLORS.text, fontSize: 12.5 },
});
