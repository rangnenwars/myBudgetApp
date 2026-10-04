import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ScreenHeader, Notice, kit } from '../../components/ScreenKit';

// Placeholder: the spec says policy text must be reviewed by a lawyer
// before launch, so this screen only marks where the policy will go.
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
      </ScrollView>
    </View>
  );
}
