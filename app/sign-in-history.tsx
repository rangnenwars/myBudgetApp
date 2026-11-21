import React, { useCallback, useState } from 'react';
import { ScrollView, View, StyleSheet, RefreshControl } from 'react-native';
import { Text } from '../components/i18n';
import { useFocusEffect } from 'expo-router';
import { Card } from '../components/Card';
import { ScreenHeader, Notice, kit } from '../components/ScreenKit';
import { COLORS, SPACING } from '../constants/theme';
import { apiErrorMessage } from '../utils/api';
import { getMySignInHistory, SignInEntry } from '../utils/database';
import { dateLocale } from '../utils/i18n';

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const PLATFORM: Record<string, string> = { web: 'Web', android: 'Android', ios: 'iPhone' };

const whatHappened = (r: SignInEntry) => {
  if (r.kind === 'login') return r.detail === 'register' ? 'Signed up' : 'Signed in';
  return r.detail === 'everywhere' ? 'Signed out everywhere' : 'Signed out';
};

// My own sign-ins and sign-outs for the last 90 days, so a stranger is easy to spot.
export default function SignInHistoryScreen() {
  const [rows, setRows] = useState<SignInEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await getMySignInHistory());
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load your sign-in history.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={kit.screen}>
      <ScreenHeader title="My sign-in history" />
      <ScrollView contentContainerStyle={kit.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        {error && <Notice tone="warning">{error}</Notice>}
        <Text style={kit.muted}>
          Times you signed in or out in the last 90 days. If you see one that is not you, change your password and sign out everywhere in Settings.
        </Text>
        {!loading && !error && rows.length === 0 && <Text style={kit.dim}>Nothing yet.</Text>}
        {rows.map((r, i) => (
          <Card key={i} style={styles.row}>
            <Text style={styles.what}>{whatHappened(r)}</Text>
            <Text style={kit.muted}>{fmtWhen(r.at)}</Text>
            <Text style={kit.dim}>
              {[r.platform ? PLATFORM[r.platform] ?? r.platform : null, r.location ? `Near ${r.location}` : null].filter(Boolean).join(' · ')}
            </Text>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2, padding: SPACING.md },
  what: { color: COLORS.text, fontWeight: '700' },
});
