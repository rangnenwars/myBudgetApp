import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card } from '../../components/Card';
import { ScreenHeader, SectionTitle, Notice, fmtInr, kit } from '../../components/ScreenKit';
import { useAuth } from '../../context/AuthContext';
import { COLORS, SPACING } from '../../constants/theme';
import { apiErrorMessage } from '../../utils/api';
import { getSystemMetrics, SystemMetrics } from '../../utils/database';

const Stat: React.FC<{ label: string; value: string | number; tone?: string }> = ({ label, value, tone }) => (
  <View style={styles.stat}>
    <Text style={[styles.statValue, tone ? { color: tone } : null]}>{typeof value === 'number' ? value.toLocaleString('en-IN') : value}</Text>
    <Text style={kit.dim}>{label}</Text>
  </View>
);

// Aggregate, count-only numbers for admins and system managers — never any
// individual's data (see server/src/routes/system.ts).
export default function MetricsScreen() {
  const { canViewMetrics } = useAuth();
  const [m, setM] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canViewMetrics) return;
    setLoading(true);
    setError(null);
    try {
      setM(await getSystemMetrics());
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load metrics.'));
    } finally {
      setLoading(false);
    }
  }, [canViewMetrics]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!canViewMetrics) {
    return (
      <View style={kit.screen}>
        <ScreenHeader title="System metrics" />
        <View style={kit.content}>
          <Notice tone="warning">Only admins and system managers can see system metrics.</Notice>
        </View>
      </View>
    );
  }

  return (
    <View style={kit.screen}>
      <ScreenHeader title="System metrics" />
      <ScrollView contentContainerStyle={kit.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        {error && <Notice tone="warning">{error}</Notice>}
        {m && (
          <>
            <SectionTitle>Users</SectionTitle>
            <Card style={styles.grid}>
              <Stat label="Total" value={m.users.total} />
              <Stat label="Active" value={m.users.active} tone={COLORS.accent} />
              <Stat label="Inactive" value={m.users.inactive} tone={m.users.inactive ? COLORS.red : undefined} />
              <Stat label="Pro" value={m.users.byTier.pro} tone={COLORS.proGold} />
            </Card>
            <Card style={styles.grid}>
              <Stat label="Members" value={m.users.byRole.user} />
              <Stat label="Admins" value={m.users.byRole.admin} />
              <Stat label="Support" value={m.users.byRole.support} />
              <Stat label="System mgrs" value={m.users.byRole.system_manager} />
            </Card>

            <SectionTitle>Engagement</SectionTitle>
            <Card style={styles.grid}>
              <Stat label="Sign-ups, 30 days" value={m.signups.last30Days} />
              <Stat label="Active, 7 days" value={m.engagement.loggedInLast7Days} />
              <Stat label="Active, 30 days" value={m.engagement.loggedInLast30Days} />
            </Card>

            <SectionTitle>Usage</SectionTitle>
            <Card style={styles.grid}>
              <Stat label="Transactions" value={m.usage.transactions} />
              <Stat label="Loans" value={m.usage.loans} />
              <Stat label="Investments" value={m.usage.investments} />
              <Stat label="Goals" value={m.usage.goals} />
              <Stat label="Custom categories" value={m.usage.customCategories} />
            </Card>

            <SectionTitle>Estimated economics (yearly)</SectionTitle>
            <Card style={styles.grid}>
              <Stat label="Cost / user" value={fmtInr(m.finance.costPerUserPerYearInr)} />
              <Stat label="Est. cost" value={fmtInr(m.finance.estimatedAnnualCostInr)} />
              <Stat label="Est. revenue" value={fmtInr(m.finance.estimatedAnnualRevenueInr)} />
              <Stat
                label="Est. margin"
                value={fmtInr(m.finance.estimatedAnnualMarginInr)}
                tone={m.finance.estimatedAnnualMarginInr < 0 ? COLORS.red : COLORS.accent}
              />
            </Card>
            <Text style={kit.dim}>{m.finance.revenueNote}</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: SPACING.md },
  stat: { width: '50%', gap: 2 },
  statValue: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
});
