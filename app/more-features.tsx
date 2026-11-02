import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Card } from '../components/Card';
import { FeatureRequestSheet } from '../components/FeatureRequestSheet';
import { Notice, ScreenHeader } from '../components/ScreenKit';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { FeatureKey, priceLabel } from '../constants/features';
import { useAuth } from '../context/AuthContext';
import { getMyFeatures, MyFeature } from '../utils/database';

// Where each switched-on feature opens.
const OPEN_ROUTE: Record<FeatureKey, string> = {
  goals: '/(tabs)/goals',
  loans: '/(tabs)/loans',
  investments: '/(tabs)/investments',
  forecast: '/plan-ahead',
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function MoreFeaturesScreen() {
  const { user, reloadUser } = useAuth();
  const [features, setFeatures] = useState<MyFeature[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState<MyFeature | null>(null);

  const load = useCallback(async () => {
    try {
      setFeatures(await getMyFeatures());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  // Staff may have answered (or an access period ended) since this was last open.
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      load();
      reloadUser().catch(() => {});
    }, [user?.id, load, reloadUser])
  );

  const onSent = (updated: MyFeature) => {
    setFeatures((list) => list?.map((f) => (f.key === updated.key ? updated : f)) ?? list);
    setAsking(null);
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader title="More features" />
      <ScrollView contentContainerStyle={styles.container}>
        {!features ? (
          <View style={styles.center}>{failed ? <Text style={styles.muted}>Could not load this. Go back and try again.</Text> : <ActivityIndicator color={COLORS.accent} />}</View>
        ) : (
          <>
            {features.map((f) => (
              <Card key={f.key} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.name}>{f.label}</Text>
                  {f.on ? (
                    <Text style={styles.on}>{f.expiresAt ? `On until ${fmtDate(f.expiresAt)}` : 'On'}</Text>
                  ) : (
                    <Text style={styles.badge}>Pro</Text>
                  )}
                </View>
                <Text style={styles.muted}>{f.description}.</Text>
                {f.on ? (
                  <Pressable onPress={() => router.push(OPEN_ROUTE[f.key] as never)} accessibilityRole="link">
                    <Text style={styles.link}>Open {f.label}</Text>
                  </Pressable>
                ) : (
                  <View style={styles.rowBetween}>
                    <Text style={styles.price}>{f.ended ? 'Access ended' : priceLabel(f.price, f.period)}</Text>
                    {f.requested ? (
                      <Text style={styles.waiting}>Requested, waiting for your admin</Text>
                    ) : (
                      <Pressable style={styles.btn} onPress={() => setAsking(f)} accessibilityRole="button" accessibilityLabel={`Request access to ${f.label}`}>
                        <Text style={styles.btnText}>{f.ended ? 'Ask again' : 'Request access'}</Text>
                      </Pressable>
                    )}
                  </View>
                )}
                {!f.on && f.ended && <Text style={styles.muted}>Your {f.label} is switched off. Everything you saved is kept.</Text>}
              </Card>
            ))}
            <Notice>Your admin switches features on after you ask. Anything you've saved stays safe if a feature is off.</Notice>
          </>
        )}
      </ScrollView>
      <FeatureRequestSheet feature={asking} onClose={() => setAsking(null)} onSent={onSent} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  container: { padding: SPACING.lg, paddingBottom: SPACING.xl * 2, gap: SPACING.md },
  center: { alignItems: 'center', padding: SPACING.lg },
  card: { gap: SPACING.xs },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: SPACING.xs },
  name: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  muted: { color: COLORS.textMuted, fontSize: 13 },
  badge: { color: COLORS.proGold, fontSize: 11, fontWeight: '700', borderColor: COLORS.proGold, borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 },
  on: { color: COLORS.positive, fontSize: 12, fontWeight: '600' },
  price: { color: COLORS.text, fontSize: 13 },
  waiting: { color: COLORS.textMuted, fontSize: 12, flexShrink: 1 },
  btn: { borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 7 },
  btnText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  link: { color: COLORS.accent, fontWeight: '600', fontSize: 13 },
});
