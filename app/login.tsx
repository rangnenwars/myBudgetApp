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
import { Link, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { COLORS, RADIUS, SPACING } from '../constants/theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.header}>Sign in to My Budget</Text>
        <Text style={styles.sub}>Required to sync and protect your data</Text>

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
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={COLORS.textDim}
              secureTextEntry={!showPassword}
              onSubmitEditing={onSubmit}
              returnKeyType="go"
            />
            <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
              <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={20} color={COLORS.textMuted} />
            </Pressable>
          </View>
        </View>

        <Link href="/forgot-password" asChild>
          <Pressable style={styles.forgotBtn} hitSlop={6}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>
        </Link>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={styles.primaryBtn} onPress={onSubmit} disabled={submitting}>
          <Text style={styles.primaryBtnText}>{submitting ? 'Signing in…' : 'Sign in'}</Text>
        </Pressable>

        <View style={styles.registerRow}>
          <Text style={styles.registerText}>New here?</Text>
          <Link href="/register" asChild>
            <Pressable>
              <Text style={styles.registerLink}> Create an account</Text>
            </Pressable>
          </Link>
        </View>

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
  passwordRow: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 44 },
  eyeBtn: { position: 'absolute', right: 12 },
  forgotBtn: { alignSelf: 'flex-end', marginTop: -SPACING.xs, marginBottom: SPACING.md },
  forgotText: { color: COLORS.accent, fontSize: 13, fontWeight: '600' },
  error: { color: COLORS.red, fontSize: 13, marginBottom: SPACING.md },
  primaryBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  primaryBtnText: { color: '#04140D', fontWeight: '700', fontSize: 16 },
  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: SPACING.lg,
  },
  registerText: { color: COLORS.textMuted, fontSize: 14 },
  registerLink: { color: COLORS.accent, fontSize: 14, fontWeight: '600' },
});
