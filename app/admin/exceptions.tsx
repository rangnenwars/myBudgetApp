import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card } from '../../components/Card';
import { ExceptionEditor } from '../../components/admin/ExceptionEditor';
import { ErrorText, Notice, ScreenHeader, kit } from '../../components/ScreenKit';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { apiErrorMessage } from '../../utils/api';
import { ExceptionRow, getExceptions } from '../../utils/plan';

type Filter = 'all' | 'ending_soon' | 'no_end';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ending_soon', label: 'Ending soon' },
  { key: 'no_end', label: 'No end date' },
];

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// Everyone with an exception, so none are forgotten: the reason, who set it, and when it ends.
// Ones with no end date are flagged. Only an admin can change them; support can look.
export default function ExceptionsScreen() {
  const { isStaff, canViewMetrics, isAdmin } = useAuth();
  const canView = isStaff || canViewMetrics;
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<ExceptionRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (f: Filter = filter) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setRows(await getExceptions(f));
      } catch (err) {
        setError(apiErrorMessage(err, 'Could not load exceptions.'));
      } finally {
        setLoading(false);
      }
    },
    [canView, filter]
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!canView) {
    return (
      <View style={kit.screen}>
        <ScreenHeader title="Exceptions" />
        <View style={styles.center}>
          <Text style={kit.muted}>Staff access required.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={kit.screen}>
      <ScreenHeader title="Exceptions" />
      <ScrollView contentContainerStyle={kit.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} />}>
        <View style={styles.chips}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              style={[styles.chip, filter === f.key && styles.chipOn]}
              onPress={() => {
                setFilter(f.key);
                setOpen(null);
                load(f.key);
              }}
            >
              <Text style={[styles.chipText, filter === f.key && styles.chipTextOn]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
        {!isAdmin && <Notice>You can look at exceptions, but only an admin can change them.</Notice>}
        <ErrorText message={error} />
        {rows && rows.length === 0 && <Text style={kit.muted}>No exceptions{filter === 'all' ? '' : ' match this'}.</Text>}
        {rows?.map((r) => (
          <Card key={r.id} style={styles.card}>
            <Pressable onPress={() => setOpen(open === r.id ? null : r.id)} accessibilityRole="button" accessibilityLabel={`${r.email}, ${r.reason}`}>
              <View style={styles.top}>
                <Text style={styles.email}>{r.email}</Text>
                {r.noEnd ? (
                  <View style={styles.flag}>
                    <Text style={styles.flagText}>No end date</Text>
                  </View>
                ) : (
                  <Text style={kit.muted}>to {fmt(r.endsAt!)}</Text>
                )}
              </View>
              <Text style={kit.muted}>{r.reason}</Text>
              <Text style={kit.dim}>
                Set {fmt(r.since)}
                {r.by ? ` by ${r.by}` : ''}
              </Text>
            </Pressable>
            {open === r.id && <ExceptionEditor userId={r.userId} current={{ reason: r.reason, ends_at: r.endsAt }} canEdit={isAdmin} onChanged={() => { setOpen(null); load(); }} />}
          </Card>
        ))}
        <Text style={kit.dim}>Exceptions with no end date stay until an admin turns them off, so they are flagged here.</Text>
        <View style={{ height: SPACING.lg }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', gap: SPACING.xs, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 7 },
  chipOn: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: COLORS.onAccent },
  card: { gap: SPACING.xs },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.sm },
  email: { color: COLORS.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  flag: { backgroundColor: `${COLORS.yellow}33`, borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 3 },
  flagText: { color: COLORS.yellow, fontSize: 11, fontWeight: '700' },
});
