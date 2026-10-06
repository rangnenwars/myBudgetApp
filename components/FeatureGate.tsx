import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { COLORS, SPACING } from '../constants/theme';
import { FeatureKey, featureLabel } from '../constants/features';
import { useAuth } from '../context/AuthContext';
import { getMyFeatures, requestFeature } from '../utils/database';
import { apiErrorMessage } from '../utils/api';
import { Button, ErrorText, ScreenHeader, kit } from './ScreenKit';

// Shown in place of Goals / Loans / Investments when staff haven't switched
// that feature on for the user (their tab is hidden too, so this is only
// reached from an old link). The user can't switch it on themselves — only
// ask. The wrapped screen isn't mounted at all, so it never calls a route
// the server would refuse.
const NotOn: React.FC<{ feature: FeatureKey }> = ({ feature }) => {
  const { reloadUser } = useAuth();
  const label = featureLabel(feature);
  const [requested, setRequested] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Staff may have answered since this screen was last seen: re-read the
  // profile (switches the screen on) and the waiting request.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      reloadUser().catch(() => {});
      getMyFeatures()
        .then((list) => active && setRequested(!!list.find((f) => f.key === feature)?.requested))
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [feature, reloadUser])
  );

  const onRequest = async () => {
    setSending(true);
    setError(null);
    try {
      const result = await requestFeature(feature);
      if (result.on) await reloadUser();
      else setRequested(result.requested);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not send the request. Try again.'));
    } finally {
      setSending(false);
    }
  };

  const goHome = () => router.replace('/');

  return (
    <View style={kit.screen}>
      <ScreenHeader title={label} />
      <View style={styles.body}>
        <Ionicons name={requested ? 'time-outline' : 'lock-closed-outline'} size={28} color={COLORS.textMuted} />
        {requested ? (
          <>
            <Text style={styles.title}>Request sent</Text>
            <Text style={[kit.muted, styles.center]}>
              You'll see the {label} tab once it's switched on. One request per feature.
            </Text>
            <Button label="Go to Home" variant="outline" onPress={goHome} style={styles.btn} />
          </>
        ) : (
          <>
            <Text style={styles.title}>{label} isn't on for your account</Text>
            <Button label={sending ? 'Sending…' : 'Request access'} onPress={onRequest} disabled={sending} style={styles.btn} />
            <ErrorText message={error} />
            <Text style={styles.link} onPress={goHome} accessibilityRole="link">
              Go to Home
            </Text>
          </>
        )}
      </View>
    </View>
  );
};

/** Renders the screen only when the feature is on for the user; otherwise the "isn't on" screen. */
export function withFeature<P extends object>(feature: FeatureKey, Screen: React.ComponentType<P>) {
  const Gated = (props: P) => {
    const { hasFeature } = useAuth();
    return hasFeature(feature) ? <Screen {...props} /> : <NotOn feature={feature} />;
  };
  Gated.displayName = `withFeature(${feature})`;
  return Gated;
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg, gap: SPACING.md },
  title: { color: COLORS.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  center: { textAlign: 'center', maxWidth: 280 },
  btn: { alignSelf: 'stretch', maxWidth: 320, width: '100%' },
  link: { color: COLORS.accent, fontSize: 14, fontWeight: '600', paddingVertical: SPACING.xs },
});
