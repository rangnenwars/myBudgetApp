import React, { useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { FONTS, T } from '../constants/theme';
import { AuthField, AuthLayout, authStyles } from '../components/ui/AuthLayout';
import { PrimaryButton, TextLink } from '../components/ui/Buttons';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setSubmitting(true);
    const result = await login(email, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? 'Sign in failed.');
      return;
    }
    router.replace('/(tabs)');
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Split bills with friends, track every rupee, and see where your month actually goes."
      onSubmit={onSubmit}
      footer={
        <>
          <View style={authStyles.footerLine}>
            <Text style={authStyles.footerText}>New to Prapanji? </Text>
            <TextLink label="Create an account" onPress={() => router.push('/register')} />
          </View>
          <Text style={authStyles.fineprint}>
            Prapanji means “ledger” in Sanskrit.{'\n'}By continuing you agree to our{' '}
            <Text style={styles.legalLink} accessibilityRole="link" onPress={() => router.push('/legal/terms')}>
              Terms
            </Text>{' '}
            and{' '}
            <Text style={styles.legalLink} accessibilityRole="link" onPress={() => router.push('/legal/privacy')}>
              Privacy Policy
            </Text>
            .
          </Text>
        </>
      }
    >
      <AuthField
        label="Email"
        name="email"
        literal
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
      />
      <AuthField
        label="Password"
        name="password"
        secure
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        autoComplete="current-password"
        textContentType="password"
        // Web submits through the <form> (Enter included); native uses the return key.
        onSubmitEditing={Platform.OS === 'web' ? undefined : onSubmit}
        returnKeyType="go"
      />

      <TextLink label="Forgot password?" onPress={() => router.push('/forgot-password')} style={styles.forgot} />

      {error && <Text style={authStyles.error}>{error}</Text>}

      <PrimaryButton label="Sign in" onPress={onSubmit} loading={submitting} submit />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  forgot: { alignSelf: 'flex-end', marginTop: -4, marginBottom: 20 },
  legalLink: { fontFamily: FONTS.medium, color: T.brand, textDecorationLine: 'underline' },
});
