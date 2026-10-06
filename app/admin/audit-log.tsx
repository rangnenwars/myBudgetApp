import React, { useCallback, useState } from 'react';
import { FlatList, View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ScreenHeader, Notice, Button, kit } from '../../components/ScreenKit';
import { useAuth } from '../../context/AuthContext';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { apiErrorMessage } from '../../utils/api';
import { getAuditLog, AuditLogEntry } from '../../utils/database';

const PAGE = 50;

const ACTION_LABEL: Record<string, string> = {
  account_updated: 'Changed account',
  account_deleted: 'Deleted account',
  feature_changed: 'Changed feature access',
  signup_features_changed: 'Changed what new users get',
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Admin-only record of what staff changed, newest first, 50 at a time.
export default function AuditLogScreen() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const page = await getAuditLog(undefined, PAGE);
      setRows(page);
      setHasMore(page.length === PAGE);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load the audit log.'));
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  const loadOlder = async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    setLoading(true);
    try {
      const page = await getAuditLog(last.id, PAGE);
      setRows((prev) => [...prev, ...page]);
      setHasMore(page.length === PAGE);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load older entries.'));
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!isAdmin) {
    return (
      <View style={kit.screen}>
        <ScreenHeader title="Audit log" />
        <View style={kit.content}>
          <Notice tone="warning">Only admins can see the audit log.</Notice>
        </View>
      </View>
    );
  }

  return (
    <View style={kit.screen}>
      <ScreenHeader title="Audit log" />
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={kit.content}
        refreshing={loading}
        onRefresh={load}
        ListHeaderComponent={
          <>
            <Text style={kit.dim}>Changes made by admins and support staff to user accounts, newest first.</Text>
            {error && <Notice tone="warning">{error}</Notice>}
          </>
        }
        ListEmptyComponent={!loading && !error ? <Text style={kit.empty}>No staff actions recorded yet.</Text> : null}
        ListFooterComponent={hasMore ? <Button label={loading ? 'Loading…' : 'Load older'} variant="outline" onPress={loadOlder} disabled={loading} /> : null}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowTop}>
              <Text style={styles.action}>{ACTION_LABEL[item.action] ?? item.action}</Text>
              <Text style={kit.dim}>{fmtWhen(item.createdAt)}</Text>
            </View>
            <Text style={kit.muted}>
              {item.actorEmail} → {item.targetEmail}
            </Text>
            {item.details ? <Text style={styles.details}>{item.details}</Text> : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: COLORS.card, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md, gap: 4 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.sm },
  action: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  details: { color: COLORS.text, fontSize: 12.5, fontFamily: 'monospace' },
});
