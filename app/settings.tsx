import React, { useState } from 'react';
import { ScrollView, View, Text, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Redirect, router } from 'expo-router';
import { Card } from '../components/Card';
import { ScreenHeader, SectionTitle, Field, Button, ErrorText, Notice, kit } from '../components/ScreenKit';
import { useAuth } from '../context/AuthContext';
import { COLORS, SPACING } from '../constants/theme';
import { apiErrorMessage } from '../utils/api';
import { confirmAction, showAlert } from '../utils/alert';
import { exportMyData, resendVerificationEmail } from '../utils/database';
import { shareTextFile } from '../utils/exportFile';

const ROLE_LABEL: Record<string, string> = { user: 'Member', admin: 'Admin', support: 'Support', system_manager: 'System manager' };

export default function SettingsScreen() {
  const { user, isLoading, changePassword, logoutEverywhere, deleteMyAccount, reloadUser } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  if (isLoading) return null;
  if (!user) return <Redirect href="/login" />;

  const onChangePassword = async () => {
    setPasswordError(null);
    if (newPassword.length < 8) {
      setPasswordError('Your new password must be at least 8 characters.');
      return;
    }
    setPasswordBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      showAlert('Password changed', 'You stay signed in here. Every other device has been signed out.');
    } catch (err) {
      setPasswordError(apiErrorMessage(err, 'Could not change your password.'));
    } finally {
      setPasswordBusy(false);
    }
  };

  const onResend = async () => {
    setVerifyMessage(null);
    try {
      await resendVerificationEmail();
      setVerifyMessage(`We sent a new link to ${user.email}. Open it on any device.`);
    } catch (err) {
      setVerifyMessage(apiErrorMessage(err, 'Could not send the email. Try again later.'));
      // Already confirmed in another tab/device — pick that up.
      await reloadUser().catch(() => {});
    }
  };

  const onExport = async () => {
    setExportBusy(true);
    try {
      const json = await exportMyData();
      await shareTextFile(`mybudget-export-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json');
    } catch (err) {
      showAlert('Export failed', apiErrorMessage(err, 'Could not download your data.'));
    } finally {
      setExportBusy(false);
    }
  };

  const onLogoutEverywhere = () => {
    confirmAction('Sign out everywhere', 'Sign out of Prapanji on every device, including this one?', 'Sign out', async () => {
      await logoutEverywhere();
      router.replace('/login');
    });
  };

  const onDelete = () => {
    setDeleteError(null);
    if (!deletePassword) {
      setDeleteError('Enter your password to confirm.');
      return;
    }
    confirmAction(
      'Delete account',
      'This permanently deletes your account and all your transactions, loans, investments, goals and settings. It cannot be undone.',
      'Delete forever',
      async () => {
        setDeleteBusy(true);
        try {
          await deleteMyAccount(deletePassword);
          router.replace('/login');
        } catch (err) {
          setDeleteError(apiErrorMessage(err, 'Could not delete your account.'));
          setDeleteBusy(false);
        }
      }
    );
  };

  return (
    <KeyboardAvoidingView style={kit.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={kit.content} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={styles.name}>{user.name}</Text>
          <Text style={kit.muted}>{user.email}</Text>
          {user.phone && <Text style={kit.muted}>{user.phone.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2')}</Text>}
          <Text style={[kit.dim, styles.role]}>
            {ROLE_LABEL[user.role] ?? user.role} · {user.tier === 'pro' ? 'Pro' : 'Standard'} plan
          </Text>
        </Card>

        {!user.emailVerified && (
          <Notice tone="warning">
            Your email isn’t confirmed yet. Confirming it lets you reset your password if you ever forget it.
          </Notice>
        )}
        {!user.emailVerified && <Button label="Send confirmation email" variant="outline" onPress={onResend} />}
        {verifyMessage && <Text style={kit.muted}>{verifyMessage}</Text>}

        <SectionTitle>Change password</SectionTitle>
        <Card style={styles.formCard}>
          <Field label="Current password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry autoComplete="current-password" />
          <Field
            label="New password"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoComplete="new-password"
            hint="At least 8 characters. Other devices will be signed out."
          />
          <ErrorText message={passwordError} />
          <Button label={passwordBusy ? 'Saving…' : 'Change password'} onPress={onChangePassword} disabled={passwordBusy || !currentPassword || !newPassword} />
        </Card>

        <SectionTitle>Your data</SectionTitle>
        <Card style={styles.formCard}>
          <Text style={kit.muted}>Download everything in your account — transactions, loans, investments, goals, accounts and budgets — as one JSON file.</Text>
          <Button label={exportBusy ? 'Preparing…' : 'Download my data'} variant="outline" onPress={onExport} disabled={exportBusy} />
        </Card>

        <SectionTitle>Sessions</SectionTitle>
        <Card style={styles.formCard}>
          <Text style={kit.muted}>Lost a phone or signed in on a shared computer? Sign out of every device at once.</Text>
          <Button label="Sign out everywhere" variant="outline" onPress={onLogoutEverywhere} />
        </Card>

        <SectionTitle>Delete account</SectionTitle>
        <Card style={[styles.formCard, styles.dangerCard]}>
          <Text style={kit.muted}>Permanently deletes your account and all of its data. Download your data first if you want a copy.</Text>
          <Field label="Password" value={deletePassword} onChangeText={setDeletePassword} secureTextEntry autoComplete="current-password" />
          <ErrorText message={deleteError} />
          <Button label={deleteBusy ? 'Deleting…' : 'Delete my account'} variant="danger" onPress={onDelete} disabled={deleteBusy} />
        </Card>
        <View style={{ height: SPACING.lg }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  name: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  role: { marginTop: SPACING.xs },
  formCard: { gap: SPACING.sm },
  dangerCard: { borderColor: `${COLORS.red}66` },
});
