import React, { useCallback, useState } from 'react';
import { ScrollView, View, StyleSheet, RefreshControl } from 'react-native';
import { Text } from '../../components/i18n';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Card } from '../../components/Card';
import { ScreenHeader, Notice, Segmented, kit } from '../../components/ScreenKit';
import { useAuth } from '../../context/AuthContext';
import { COLORS, SPACING } from '../../constants/theme';
import { apiErrorMessage } from '../../utils/api';
import { getUserActivity, UserActivity } from '../../utils/database';
import { dateLocale } from '../../utils/i18n';

type Range = '7' | '30' | '90';

const fmt = (iso: string, withDate: boolean) =>
  new Date(iso).toLocaleString(
    dateLocale(),
    withDate ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' }
  );

// Admin only. One person's visits, newest first: signed in, the pages they opened in order, signed out.
export default function ActivityUserScreen() {
  const { isAdmin } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [range, setRange] = useState<Range>('30');
  const [data, setData] = useState<UserActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAdmin || !id) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getUserActivity(Number(id), Number(range)));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load this person’s activity.'));
    } finally {
      setLoading(false);
    }
  }, [isAdmin, id, range]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!isAdmin) {
    return (
      <View style={kit.screen}>
        <ScreenHeader title="Activity" />
        <View style={kit.content}>
          <Notice tone="warning">Only admins can see one person’s activity.</Notice>
        </View>
      </View>
    );
  }

  return (
    <View style={kit.screen}>
      <ScreenHeader title="Activity" />
      <ScrollView contentContainerStyle={kit.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
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
            <Card style={{ gap: 2 }}>
              <Text style={styles.name}>{data.person.name}</Text>
              <Text style={kit.muted}>{data.person.email}</Text>
              <Text style={kit.dim}>
                {data.logins} sign-ins · {data.lastSeen ? `last seen ${fmt(data.lastSeen, true)}` : 'no activity in this range'}
              </Text>
            </Card>
            {data.sessions.map((s, i) => (
              <Card key={i} style={{ gap: SPACING.xs }}>
                <Text style={styles.name}>
                  {fmt(s.start, true)} – {fmt(s.end, false)}
                </Text>
                <Text style={kit.dim}>{[s.platform, s.location ? `Near ${s.location}` : null].filter(Boolean).join(' · ')}</Text>
                {s.events.map((e, j) => (
                  <Text key={j} style={kit.muted}>
                    {fmt(e.at, false)} · {e.kind === 'login' ? 'Signed in' : e.kind === 'logout' ? 'Signed out' : e.label ?? e.page}
                  </Text>
                ))}
              </Card>
            ))}
            <Text style={kit.dim}>Pages only: no amounts, names or ids. Viewing this is recorded in the audit log.</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({ name: { color: COLORS.text, fontWeight: '700' } });
