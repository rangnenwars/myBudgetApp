import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ScreenHeader, Notice, kit } from '../../components/ScreenKit';

// Placeholder: the spec says policy text must be reviewed by a lawyer
// before launch, so this screen only marks where the terms will go.
export default function TermsScreen() {
  return (
    <View style={kit.screen}>
      <ScreenHeader title="Terms of use" />
      <ScrollView contentContainerStyle={kit.content}>
        <Notice tone="info">These terms are a draft placeholder and will be finalised before Prapanji launches.</Notice>
        <Text style={kit.muted}>
          Prapanji is a personal money app. Every account manages only its own money, and you are responsible for the entries you add.
        </Text>
      </ScrollView>
    </View>
  );
}
