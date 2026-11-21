import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, StyleSheet, RefreshControl, Pressable, TextInput } from 'react-native';
import { Text } from '../../components/i18n';
import { router, useFocusEffect } from 'expo-router';
import { Card } from '../../components/Card';
import { ScreenHeader, SectionTitle, Notice, Segmented, kit } from '../../components/ScreenKit';
import { useAuth } from '../../context/AuthContext';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { apiErrorMessage } from '../../utils/api';
import { getActivityOverview, getAdminUsers, ActivityOverview, AdminUser } from '../../utils/database';

type Range = '7' | '30' | '90';

const PLATFORM: Record<string, string> = { web: 'Web', android: 'Android', ios: 'iPhone' };

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <View style={styles.stat}>
    <Text style={styles.statValue}>{value.toLocaleString('en-IN')}</Text>
    <Text style={kit.dim}>{label}</Text>
  </View>
);

// Counts only: how often people sign in and which pages they use. Customer accounts; staff are left out.
// Admins can also open one person's timeline (every look is written to the audit log).
export default function ActivityScreen() {
  const { canViewMetrics, isAdmin } = useAuth();
  const [range, setRange] = useState<Range>('7');
  const [data, setData] = useState<ActivityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<AdminUser[]>([]);

  const load = useCallback(async () => {
    if (!canViewMetrics) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getActivityOverview(Number(range)));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load activity.'));
    } finally {
      setLoading(false);
    }
  }, [canViewMetrics, range]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (!isAdmin || q.trim().length < 2) {
      setFound([]);
      return;
    }
    const t = setTimeout(() => {
      getAdminUsers(q.trim(), 8)
        .then((r) => setFound(r.items))
        .catch(() => setFound([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, isAdmin]);

  if (!canViewMetrics) {
    return (
      <View style={kit.screen}>
        <ScreenHeader title="User activity" />
        <View style={kit.content}>
          <Notice tone="warning">Only admins and system managers can see user activity.</Notice>
        </View>
      </View>
    );
  }

  const max = Math.max(1, ...(data?.topPages.map((p) => p.count) ?? [1]));
  return (
    <View style={kit.screen}>
      <ScreenHeader title="User activity" />
      <ScrollView
        contentContainerStyle={kit.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        {error && <Notice tone="warning">{error}</Notice>}
        <Segmented<Range>
          options={[
            { key: '7', label: '7 days' },
            { key: '30', label: '30 days' },
            { key: '90', label: '90 days' },
          ]}
          value={range}
          onChange={setRange}
        />
        {data && (
          <>
            <Card style={styles.grid}>
              <Stat label="Sign-ins" value={data.logins} />
              <Stat label="People" value={data.people} />
              <Stat label="Page views" value={data.pageViews} />
            </Card>

            <SectionTitle>Most visited pages</SectionTitle>
            <Card style={{ gap: SPACING.sm }}>
              {data.topPages.length === 0 && <Text style={kit.dim}>No page views yet.</Text>}
              {data.topPages.map((p) => (
                <View key={p.page} style={{ gap: 2 }}>
                  <View style={styles.between}>
                    <Text style={kit.muted}>{p.label}</Text>
                    <Text style={kit.dim}>{p.count.toLocaleString('en-IN')}</Text>
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.bar, { width: `${Math.max(3, (p.count / max) * 100)}%` }]} />
                  </View>
                </View>
              ))}
            </Card>

            <SectionTitle>Where people sign in from</SectionTitle>
            <Card style={{ gap: SPACING.xs }}>
              {Object.keys(data.platforms).length === 0 && <Text style={kit.dim}>No sign-ins yet.</Text>}
              {Object.entries(data.platforms).map(([name, n]) => (
                <View key={name} style={styles.between}>
                  <Text style={kit.muted}>{PLATFORM[name] ?? 'Unknown'}</Text>
                  <Text style={kit.dim}>{n}</Text>
                </View>
              ))}
            </Card>
          </>
        )}

        {isAdmin && (
          <>
            <SectionTitle>One person’s activity</SectionTitle>
            <TextInput
              style={styles.search}
              value={q}
              onChangeText={setQ}
              placeholder="Search name or email"
              placeholderTextColor={COLORS.textDim}
              autoCapitalize="none"
            />
            {found.map((u) => (
              <Pressable key={u.id} onPress={() => router.push({ pathname: '/admin/activity-user', params: { id: String(u.id) } })}>
                <Card style={{ gap: 2 }}>
                  <Text style={styles.personName}>{u.name}</Text>
                  <Text style={kit.dim}>{u.email}</Text>
                </Card>
              </Pressable>
            ))}
            <Text style={kit.dim}>Pages only: no amounts, names or ids. Viewing a person’s activity is recorded in the audit log.</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: SPACING.md },
  stat: { width: '33%', gap: 2 },
  statValue: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  personName: { color: COLORS.text, fontWeight: '700' },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { height: 6, borderRadius: 3, backgroundColor: COLORS.cardBorder },
  bar: { height: 6, borderRadius: 3, backgroundColor: COLORS.accent },
  search: { borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.md, padding: SPACING.sm, color: COLORS.text },
});
