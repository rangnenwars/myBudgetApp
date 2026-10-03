import React, { useState } from 'react';
import { ScrollView, Text, KeyboardAvoidingView, Platform } from 'react-native';
import { ScreenHeader, Field, Button, ErrorText, Notice, kit } from '../components/ScreenKit';
import { apiErrorMessage } from '../utils/api';
import { requestPasswordReset } from '../utils/database';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Enter the email you signed up with.');
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not send the reset email. Try again later.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={kit.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Reset password" />
      <ScrollView contentContainerStyle={kit.content} keyboardShouldPersistTaps="handled">
        {sent ? (
          <Notice tone="success">
            If an account exists for {email.trim()}, we’ve emailed it a link to choose a new password. The link works for 1 hour. Check your spam folder if it
            doesn’t arrive in a few minutes.
          </Notice>
        ) : (
          <>
            <Text style={kit.muted}>Enter your account email and we’ll send you a link to choose a new password.</Text>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onSubmitEditing={onSubmit}
            />
            <ErrorText message={error} />
            <Button label={busy ? 'Sending…' : 'Send reset link'} onPress={onSubmit} disabled={busy} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
