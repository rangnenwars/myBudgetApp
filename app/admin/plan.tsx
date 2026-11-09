import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Switch, Pressable, RefreshControl } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { Card } from '../../components/Card';
import { Button, ErrorText, Field, Notice, ScreenHeader, Segmented, SectionTitle, kit } from '../../components/ScreenKit';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { FEATURES, FeatureKey } from '../../constants/features';
import { useAuth } from '../../context/AuthContext';
import { confirmAction } from '../../utils/alert';
import { apiErrorMessage } from '../../utils/api';
import {
  AdminPlanOverview,
  DryRun,
  ExpiringRow,
  getAdminPlan,
  getDryRun,
  getExpiring,
  notifyExistingUsers,
  saveAdminPlan,
  setEnforcement,
} from '../../utils/plan';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// Staff view of the paid plan: price and length, who would lose access, the notice to existing
// users, and the switch that makes the plan real. Staff read; only an admin changes things, and
// the big actions ask for the admin's password again (server: routes/adminPlan.ts).
export default function AdminPlanScreen() {
  const { isStaff, canViewMetrics, isAdmin } = useAuth();
  const canView = isStaff || canViewMetrics;
  const [overview, setOverview] = useState<AdminPlanOverview | null>(null);
  const [dry, setDry] = useState<DryRun | null>(null);
  const [expiring, setExpiring] = useState<{ ending: ExpiringRow[]; ended: ExpiringRow[]; pending_claims: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The editable form.
  const [price, setPrice] = useState('');
  const [period, setPeriod] = useState<'month' | 'year'>('year');
  const [trialMonths, setTrialMonths] = useState('');
  const [noticeDays, setNoticeDays] = useState('');
  const [features, setFeatures] = useState<FeatureKey[]>([]);
  const [saved, setSaved] = useState(false);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const [o, d, e] = await Promise.all([getAdminPlan(), getDryRun(), getExpiring()]);
      setOverview(o);
      setDry(d);
      setExpiring(e);
      setPrice(String(o.plan.price_inr));
      setPeriod(o.plan.period);
      setTrialMonths(String(o.plan.trial_months));
      setNoticeDays(String(o.plan.notice_days));
      setFeatures(o.plan.features);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load the plan.'));
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!canView) {
    return (
      <View style={kit.screen}>
        <ScreenHeader title="Plan and pricing" />
        <View style={styles.denied}>
          <Text style={kit.muted}>Staff access required.</Text>
        </View>
      </View>
    );
  }

  const plan = overview?.plan;
  const onSave = async () => {
    setError(null);
    setSaved(false);
    const p = Number(price);
    const t = Number(trialMonths);
    const n = Number(noticeDays);
    if (!(p > 0)) return setError('Enter a price above 0.');
    if (!Number.isInteger(t) || t < 1 || t > 36) return setError('Free months must be a whole number from 1 to 36.');
    if (!Number.isInteger(n) || n < 7 || n > 180) return setError('Notice days must be a whole number from 7 to 180.');
    setBusy(true);
    try {
      await saveAdminPlan({ price_inr: p, period, trial_months: t, notice_days: n, features });
      setSaved(true);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  const needPassword = (): boolean => {
    if (password) return true;
    setError('Enter your password in the box below to confirm.');
    return false;
  };

  const onNotify = () => {
    setError(null);
    if (!needPassword()) return;
    confirmAction(
      'Send the notice',
      'This emails every customer when their free access ends, and moves any end date that is sooner than the notice period out to it. Nobody is locked by this. Send it?',
      'Send',
      async () => {
        setBusy(true);
        try {
          const r = await notifyExistingUsers(password);
          setMessage(`Notice sent: ${r.emailed} emailed, ${r.extended} end dates moved, ${r.customers} customers.`);
          setPassword('');
          await load();
        } catch (err) {
          setError(apiErrorMessage(err, 'Could not send the notice.'));
        } finally {
          setBusy(false);
        }
      }
    );
  };

  const onEnforce = (on: boolean) => {
    setError(null);
    if (!needPassword()) return;
    confirmAction(
      on ? 'Turn the plan on' : 'Turn the plan off',
      on
        ? `From now, customers whose access has ended are locked out of the paid features. ${dry?.would_lose ?? 0} would lose access today. Turn it on?`
        : 'Everyone gets their access back at once. Turn it off?',
      on ? 'Turn on' : 'Turn off',
      async () => {
        setBusy(true);
        try {
          await setEnforcement(on, password);
          setMessage(on ? 'The plan is now ON.' : 'The plan is now OFF.');
          setPassword('');
          await load();
        } catch (err) {
          setError(apiErrorMessage(err, 'Could not change this.'));
        } finally {
          setBusy(false);
        }
      }
    );
  };

  return (
    <View style={kit.screen}>
      <ScreenHeader title="Plan and pricing" />
      <ScrollView contentContainerStyle={kit.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        {!isAdmin && <Notice>Support and system managers can look, but only an admin can change the plan.</Notice>}
        <ErrorText message={error} />
        {message && <Notice tone="success">{message}</Notice>}

        {overview && (
          <View style={styles.stats}>
            <Stat label="Customers" value={overview.stats.customers} />
            <Stat label="Free trial" value={overview.stats.trials} />
            <Stat label="Paid" value={overview.stats.paid} />
            <Stat label="Company" value={overview.stats.company} />
            <Stat label="Exceptions" value={overview.stats.exceptions} />
            <Stat label="To confirm" value={overview.stats.pending} />
          </View>
        )}

        <View style={styles.links}>
          <LinkChip icon="cash-outline" label="Payments to confirm" badge={overview?.stats.pending} onPress={() => router.push('/admin/payments')} />
          <LinkChip icon="qr-code-outline" label="Payment details" onPress={() => router.push('/admin/payment-details')} />
          <LinkChip icon="shield-checkmark-outline" label="Exceptions" badge={overview?.stats.exceptions} onPress={() => router.push('/admin/exceptions')} />
        </View>

        <SectionTitle>Price and length</SectionTitle>
        <Card style={styles.form}>
          <Field label="Price (₹)" value={price} onChangeText={setPrice} keyboardType="numeric" editable={isAdmin} hint="Applies to renewals from now on. Each payment keeps the price it was paid at." />
          <Text style={kit.muted}>Per</Text>
          <Segmented<'month' | 'year'>
            options={[
              { key: 'year', label: 'Year' },
              { key: 'month', label: 'Month' },
            ]}
            value={period}
            onChange={isAdmin ? setPeriod : () => {}}
          />
          <Field label="Free full access for new users (months)" value={trialMonths} onChangeText={setTrialMonths} keyboardType="number-pad" editable={isAdmin} hint="Counted from each person's own sign-up date." />
          <Field label="Notice for existing users (days)" value={noticeDays} onChangeText={setNoticeDays} keyboardType="number-pad" editable={isAdmin} hint="Nobody's access ends sooner than this after the notice is sent." />
        </Card>

        <SectionTitle>What the plan includes</SectionTitle>
        <Card style={styles.form}>
          {FEATURES.map((f) => (
            <View key={f.key} style={styles.switchRow}>
              <Text style={styles.switchLabel}>{f.label}</Text>
              <Switch
                value={features.includes(f.key)}
                onValueChange={(v) => setFeatures((cur) => (v ? [...cur, f.key] : cur.filter((k) => k !== f.key)))}
                disabled={!isAdmin}
                trackColor={{ false: COLORS.cardBorder, true: COLORS.accent }}
              />
            </View>
          ))}
          <Text style={kit.dim}>Pro insights and trends always go with the plan. A feature left off here is free for everyone.</Text>
          {isAdmin && <Button label={busy ? 'Saving…' : 'Save'} onPress={onSave} disabled={busy} />}
          {saved && <Text style={styles.savedText}>Saved.</Text>}
        </Card>

        <SectionTitle>Turning the plan on</SectionTitle>
        <Card style={[styles.form, plan?.enforced && { borderColor: `${COLORS.accent}88` }]}>
          <Text style={styles.statusLine}>
            {plan?.enforced ? `ON since ${plan.enforced_at ? fmtDate(plan.enforced_at) : 'earlier'}. Customers whose access has ended are locked out.` : 'OFF (shadow mode). Nobody is locked. Access works as before.'}
          </Text>
          <Step n={1} done={!!dry} title="Check the dry run">
            {dry ? (
              <Text style={kit.muted}>
                {dry.would_lose} of {dry.customers} customers would lose the paid features if it were on right now.
              </Text>
            ) : null}
            {dry && dry.users.slice(0, 5).map((u) => (
              <Text key={u.id} style={kit.dim}>
                {u.email} · ended {u.plan_end ? fmtDate(u.plan_end) : 'n/a'}
              </Text>
            ))}
            {dry && dry.users.length > 5 && <Text style={kit.dim}>and {dry.users.length - 5} more</Text>}
          </Step>
          <Step n={2} done={!!plan?.existing_notice_at} title="Send the notice to existing users">
            <Text style={kit.muted}>{plan?.existing_notice_at ? `Sent on ${fmtDate(plan.existing_notice_at)}. You can run it again for new customers.` : 'Not sent yet. It must go out before you can turn the plan on.'}</Text>
          </Step>
          <Step n={3} done={!!plan?.enforced} title="Turn it on">
            <Text style={kit.muted}>You can turn it off again at any time. Everyone then gets their access back at once.</Text>
          </Step>

          {isAdmin && (
            <>
              <Field label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" hint="Asked again for these three actions." />
              <Button label="Send the notice to existing users" variant="outline" onPress={onNotify} disabled={busy} />
              {plan?.enforced ? (
                <Button label="Turn the plan off" variant="danger" onPress={() => onEnforce(false)} disabled={busy} />
              ) : (
                <Button label="Turn the plan on" onPress={() => onEnforce(true)} disabled={busy || !plan?.existing_notice_at} />
              )}
            </>
          )}
        </Card>

        <SectionTitle>Ending soon</SectionTitle>
        <Card style={styles.form}>
          {!expiring ? (
            <Text style={kit.muted}>Loading…</Text>
          ) : (
            <>
              <Text style={kit.muted}>
                {expiring.ending.length} ending in the next 30 days · {expiring.ended.length} ended in the last 30 · {expiring.pending_claims} payments waiting
              </Text>
              {[...expiring.ending.slice(0, 8), ...expiring.ended.slice(0, 5)].map((r) => (
                <Text key={`${r.ended ? 'e' : 'n'}${r.id}`} style={kit.dim}>
                  {r.email} · {r.ended ? 'ended' : 'ends'} {fmtDate(r.plan_end)}
                </Text>
              ))}
              <Text style={kit.dim}>Company accounts and exceptions are never listed.</Text>
            </>
          )}
        </Card>
        <View style={{ height: SPACING.lg }} />
      </ScrollView>
    </View>
  );
}

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <View style={styles.stat}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const LinkChip: React.FC<{ icon: React.ComponentProps<typeof Ionicons>['name']; label: string; badge?: number; onPress: () => void }> = ({ icon, label, badge, onPress }) => (
  <Pressable style={styles.link} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
    <Ionicons name={icon} size={18} color={COLORS.accent} />
    <Text style={styles.linkText}>{label}</Text>
    {badge != null && badge > 0 && (
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{badge}</Text>
      </View>
    )}
  </Pressable>
);

const Step: React.FC<{ n: number; done: boolean; title: string; children?: React.ReactNode }> = ({ n, done, title, children }) => (
  <View style={styles.step}>
    <View style={[styles.stepDot, done && styles.stepDotDone]}>
      <Text style={[styles.stepNum, done && { color: COLORS.onAccent }]}>{done ? '✓' : n}</Text>
    </View>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={styles.stepTitle}>{title}</Text>
      {children}
    </View>
  </View>
);

const styles = StyleSheet.create({
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  stat: { backgroundColor: COLORS.card, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, minWidth: 96, flexGrow: 1 },
  statValue: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  statLabel: { color: COLORS.textMuted, fontSize: 12 },
  links: { gap: SPACING.xs },
  link: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md, backgroundColor: COLORS.card },
  linkText: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: '600' },
  badge: { backgroundColor: COLORS.red, borderRadius: RADIUS.full, minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, alignItems: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  form: { gap: SPACING.sm },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  switchLabel: { color: COLORS.text, fontSize: 14 },
  savedText: { color: COLORS.positive, fontSize: 13, fontWeight: '600' },
  statusLine: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  step: { flexDirection: 'row', gap: SPACING.sm },
  stepDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: COLORS.cardBorder, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepDotDone: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  stepNum: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  stepTitle: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
});
