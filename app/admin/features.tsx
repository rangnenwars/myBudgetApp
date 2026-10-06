import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl, Switch } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card } from '../../components/Card';
import { ScreenHeader, SectionTitle, Notice, Button, ErrorText, kit } from '../../components/ScreenKit';
import { useAuth } from '../../context/AuthContext';
import { COLORS, SPACING } from '../../constants/theme';
import { FEATURES, FeatureKey, featureLabel } from '../../constants/features';
import { apiErrorMessage } from '../../utils/api';
import {
  getFeatureOverview,
  getFeatureUsers,
  saveSignupFeatureDefaults,
  setUserFeature,
  FeatureOverview,
  FeatureUser,
} from '../../utils/database';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// Staff view of optional-feature access: what new accounts get, who is asking
// for a feature, and how many users have each one. Admin and system manager
// can change things; support can only look (server: routes/adminFeatures.ts).
// A single user's switches are on the Users screen (admin/index.tsx).
export default function AdminFeaturesScreen() {
  const { isStaff, canViewMetrics } = useAuth();
  const canManage = canViewMetrics;
  const canView = isStaff || canViewMetrics;
  const [data, setData] = useState<FeatureOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<FeatureKey | null>(null);
  const [users, setUsers] = useState<{ items: FeatureUser[]; total: number } | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getFeatureOverview());
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load feature access.'));
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const onDefault = (key: FeatureKey, on: boolean) => {
    if (!data) return;
    run(() => saveSignupFeatureDefaults({ ...data.defaults, [key]: on }), 'Could not save the sign-up defaults.');
  };

  const onAnswer = (userId: number, key: FeatureKey, on: boolean) => run(() => setUserFeature(userId, key, on), 'Could not answer this request.');

  const onToggleUsers = async (key: FeatureKey) => {
    if (open === key) {
      setOpen(null);
      return;
    }
    setOpen(key);
    setUsers(null);
    try {
      setUsers(await getFeatureUsers(key));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load the users.'));
    }
  };

  if (!canView) {
    return (
      <View style={kit.screen}>
        <ScreenHeader title="Feature access" />
        <View style={kit.content}>
          <Notice tone="warning">Staff access required.</Notice>
        </View>
      </View>
    );
  }

  return (
    <View style={kit.screen}>
      <ScreenHeader title="Feature access" />
      <ScrollView contentContainerStyle={kit.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        {!canManage && <Notice>You can see feature access but only an admin or system manager can change it.</Notice>}
        <ErrorText message={error} />
        {data && (
          <>
            <Text style={kit.muted}>Home, Transactions, Reports, Budgets, Accounts, Input expenses and People are always on for everyone.</Text>

            <SectionTitle>New users get</SectionTitle>
            <Card>
              {FEATURES.map((f, i) => (
                <View key={f.key} style={[styles.row, i > 0 && styles.rowBorder]}>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle}>{f.label}</Text>
                    <Text style={kit.dim}>{f.description}</Text>
                  </View>
                  <Switch
                    value={data.defaults[f.key]}
                    onValueChange={(v) => onDefault(f.key, v)}
                    disabled={busy || !canManage}
                    trackColor={{ false: COLORS.cardBorder, true: COLORS.accent }}
                    accessibilityLabel={`New users get ${f.label}`}
                  />
                </View>
              ))}
            </Card>
            <Text style={kit.dim}>Applies to people who sign up from now on. Existing users don't change.</Text>

            {data.requests.length > 0 && (
              <>
                <SectionTitle>Waiting requests ({data.requests.length})</SectionTitle>
                <Card>
                  {data.requests.map((r, i) => (
                    <View key={`${r.userId}-${r.feature}`} style={[styles.request, i > 0 && styles.rowBorder]}>
                      <Text style={styles.rowTitle}>
                        {r.name} wants {featureLabel(r.feature)}
                      </Text>
                      <Text style={kit.dim}>
                        {r.email} · asked {fmtDate(r.requestedAt)}
                      </Text>
                      {canManage && (
                        <View style={styles.actions}>
                          <Button label="Switch on" onPress={() => onAnswer(r.userId, r.feature, true)} disabled={busy} style={styles.action} />
                          <Button label="Decline" variant="outline" onPress={() => onAnswer(r.userId, r.feature, false)} disabled={busy} style={styles.action} />
                        </View>
                      )}
                    </View>
                  ))}
                </Card>
              </>
            )}

            <SectionTitle>Who has what</SectionTitle>
            <Card>
              {data.features.map((f, i) => (
                <View key={f.key} style={[styles.request, i > 0 && styles.rowBorder]}>
                  <View style={styles.row}>
                    <View style={styles.rowMain}>
                      <Text style={styles.rowTitle}>{f.label}</Text>
                      <Text style={kit.dim}>
                        {f.usersOn} of {data.totalUsers} users
                      </Text>
                    </View>
                    <Button
                      label={open === f.key ? 'Hide' : 'View'}
                      variant="outline"
                      onPress={() => onToggleUsers(f.key)}
                      style={styles.viewBtn}
                    />
                  </View>
                  {open === f.key && (
                    <View style={styles.userList}>
                      {!users ? (
                        <Text style={kit.dim}>Loading…</Text>
                      ) : users.items.length === 0 ? (
                        <Text style={kit.dim}>Nobody has {f.label} yet.</Text>
                      ) : (
                        <>
                          {users.items.map((u) => (
                            <Text key={u.id} style={kit.muted}>
                              {u.name} · {u.email}
                            </Text>
                          ))}
                          {users.total > users.items.length && <Text style={kit.dim}>and {users.total - users.items.length} more</Text>}
                        </>
                      )}
                    </View>
                  )}
                </View>
              ))}
            </Card>
            <Text style={kit.dim}>To change one person's features, open them on the Users screen.</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: SPACING.sm },
  rowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  request: { gap: 4, paddingVertical: SPACING.sm },
  actions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
  action: { flex: 1, paddingVertical: 9 },
  viewBtn: { paddingVertical: 7, paddingHorizontal: SPACING.md },
  userList: { gap: 2, paddingTop: SPACING.xs },
});
