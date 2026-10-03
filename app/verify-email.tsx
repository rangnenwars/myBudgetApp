import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ScreenHeader, Button, Notice, kit } from '../components/ScreenKit';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage } from '../utils/api';
import { verifyEmail } from '../utils/database';

// Opened from the link in the confirmation email: /verify-email?token=…
// Works whether or not the user is signed in on this device.
export default function VerifyEmailScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { user, reloadUser } = useAuth();
  const missingToken = !token;
  const [state, setState] = useState<'working' | 'done' | 'error'>(missingToken ? 'error' : 'working');
  const [error, setError] = useState<string | null>(missingToken ? 'This page needs the link from your confirmation email.' : null);
  const started = useRef(false);

  useEffect(() => {
    // Once only: the token is single-use, so a re-render must not re-submit it.
    if (started.current) return;
    started.current = true;
    if (!token) return;
    verifyEmail(String(token))
      .then(async () => {
        setState('done');
        await reloadUser().catch(() => {});
      })
      .catch((err) => {
        setState('error');
        setError(apiErrorMessage(err, 'Could not confirm your email.'));
      });
  }, [token, reloadUser]);

  return (
    <View style={kit.screen}>
      <ScreenHeader title="Confirm email" />
      <ScrollView contentContainerStyle={kit.content}>
        {state === 'working' && <Text style={kit.muted}>Confirming your email…</Text>}
        {state === 'done' && <Notice tone="success">Thanks — your email is confirmed.</Notice>}
        {state === 'error' && (
          <Notice tone="warning">
            {error} {user ? 'You can send a new link from Settings.' : 'Sign in and send a new link from Settings.'}
          </Notice>
        )}
        {state !== 'working' && <Button label={user ? 'Go to dashboard' : 'Sign in'} onPress={() => router.replace(user ? '/' : '/login')} />}
      </ScrollView>
    </View>
  );
}
