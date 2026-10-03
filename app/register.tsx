import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { COLORS, RADIUS, SPACING } from '../constants/theme';

export default function RegisterScreen() {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    setError(null);
    if (!name.trim() || !email.trim() || !password) {
      setError('Fill in all fields.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    const result = await register(name, email, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not create account.');
      return;
    }
    router.replace('/(tabs)');
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.header}>Create your account</Text>
        <Text style={styles.sub}>Free to start — securely synced to your account from day one</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={COLORS.textDim}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={COLORS.textDim}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            placeholderTextColor={COLORS.textDim}
            secureTextEntry
          />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={styles.primaryBtn} onPress={onSubmit} disabled={submitting}>
          <Text style={styles.primaryBtnText}>{submitting ? 'Creating…' : 'Create account'}</Text>
        </Pressable>

        <Pressable style={styles.backRow} onPress={() => router.back()}>
          <Text style={styles.backText}>Already have an account? Sign in</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  container: { flexGrow: 1, padding: SPACING.lg, justifyContent: 'center' },
  header: { color: COLORS.text, fontSize: 24, fontWeight: '700', marginBottom: SPACING.xs },
  sub: { color: COLORS.textMuted, fontSize: 14, marginBottom: SPACING.xl },
  field: { marginBottom: SPACING.md },
  label: { color: COLORS.textMuted, fontSize: 13, marginBottom: SPACING.xs },
  input: {
    backgroundColor: COLORS.input,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    color: COLORS.text,
    fontSize: 15,
  },
  error: { color: COLORS.red, fontSize: 13, marginBottom: SPACING.md },
  primaryBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  primaryBtnText: { color: '#04140D', fontWeight: '700', fontSize: 16 },
  backRow: { marginTop: SPACING.lg, alignItems: 'center' },
  backText: { color: COLORS.accent, fontSize: 14, fontWeight: '600' },
});
