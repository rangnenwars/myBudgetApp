import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../components/i18n';
import { ScreenHeader, Notice, kit } from '../../components/ScreenKit';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';

// Placeholder: the spec says policy text must be reviewed by a lawyer
// before launch, so this screen only marks where the policy will go.
// "Problem reports" describes what server/src/lib/issuePrivacy.ts actually
// does — keep the two in step (docs/SECURITY_REVIEW.md).
export default function PrivacyScreen() {
  return (
    <View style={kit.screen}>
      <ScreenHeader title="Privacy policy" />
      <ScrollView contentContainerStyle={kit.content}>
        <Notice tone="info">This policy is a draft placeholder and will be finalised before Prapanji launches.</Notice>
        <Text style={kit.muted}>
          Your data is used only to run your own ledger. It is never used for ads or lending without your separate, explicit consent. You can download
          or delete everything from Settings at any time.
        </Text>
        <View style={styles.section}>
          <Text style={styles.heading}>Sign-ins and pages visited</Text>
          <Text style={kit.muted}>
            We record when you sign in or out, with the kind of device and the first part of your internet address, to show you your own sign-in history and to understand how the app is used.
            Unless you switch it off in Settings, we also record the names of the pages you open, never what is on them: no amounts, names or what you type.
            Detailed records are kept for 90 days, then only anonymous daily counts remain. Our administrators can see your sign-ins and pages visited, and each time they look is written to an audit log.
            You can download these records with your data, and they are deleted with your account.
          </Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.heading}>Problem reports</Text>
          <Text style={kit.muted}>
            When you report a problem, only our team reads it, to fix the problem. A screenshot you attach can be opened
            only by you and our administrators, and is deleted 90 days after the problem is resolved. Reports are included when you download your data
            and deleted with your account.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderWidth: 1, borderColor: COLORS.blue, borderRadius: RADIUS.md, padding: SPACING.md, gap: SPACING.xs },
  heading: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
});
