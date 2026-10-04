import React, { useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { AuthField, AuthLayout, PhoneField, authStyles, isValidIndianMobile } from '../components/ui/AuthLayout';
import { PrimaryButton, TextLink } from '../components/ui/Buttons';

export default function RegisterScreen() {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    setError(null);
    if (!name.trim() || !phone || !email.trim() || !password) {
      setError('Fill in all fields.');
      return;
    }
    if (!isValidIndianMobile(phone)) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    const result = await register(name, email, phone, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not create account.');
      return;
    }
    router.replace('/(tabs)');
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Track every rupee and see where your month actually goes."
      onSubmit={onSubmit}
      footer={
        <View style={authStyles.footerLine}>
          <Text style={authStyles.footerText}>Already have an account? </Text>
          <TextLink label="Sign in" onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))} />
        </View>
      }
    >
      <AuthField
        label="Name"
        name="name"
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        autoComplete="name"
        textContentType="name"
      />
      <PhoneField value={phone} onChangeText={setPhone} />
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
      />
      <AuthField
        label="Password"
        name="new-password"
        secure
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        hint="Use 8 or more characters."
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={Platform.OS === 'web' ? undefined : onSubmit}
        returnKeyType="go"
      />

      {error && <Text style={authStyles.error}>{error}</Text>}

      <PrimaryButton label="Create account" onPress={onSubmit} loading={submitting} style={styles.submit} submit />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  submit: { marginTop: 4 },
});
