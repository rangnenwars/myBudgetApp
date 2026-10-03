import React, { useState } from 'react';
import { ScrollView, Text, KeyboardAvoidingView, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ScreenHeader, Field, Button, ErrorText, Notice, kit } from '../components/ScreenKit';
import { apiErrorMessage } from '../utils/api';
import { resetPassword } from '../utils/database';

// Opened from the link in the password-reset email: /reset-password?token=…
export default function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async () => {
    setError(null);
    if (password.length < 8) {
      setError('Your new password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await resetPassword(String(token), password);
      setDone(true);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not reset your password.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={kit.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Choose a new password" />
      <ScrollView contentContainerStyle={kit.content} keyboardShouldPersistTaps="handled">
        {!token ? (
          <>
            <Notice tone="warning">This page needs the link from your reset email. Ask for a new link if yours is missing or broken.</Notice>
            <Button label="Send a new link" onPress={() => router.replace('/forgot-password')} />
          </>
        ) : done ? (
          <>
            <Notice tone="success">Your password has been changed and every device has been signed out. Sign in with your new password.</Notice>
            <Button label="Sign in" onPress={() => router.replace('/login')} />
          </>
        ) : (
          <>
            <Text style={kit.muted}>Pick a new password for your account. You’ll be signed out everywhere afterwards.</Text>
            <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" hint="At least 8 characters." />
            <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" onSubmitEditing={onSubmit} />
            <ErrorText message={error} />
            <Button label={busy ? 'Saving…' : 'Save new password'} onPress={onSubmit} disabled={busy} />
            {error && /expired|invalid/i.test(error) && <Button label="Send a new link" variant="outline" onPress={() => router.replace('/forgot-password')} />}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
