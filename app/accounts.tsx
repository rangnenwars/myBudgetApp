import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Pressable, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { Redirect, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../components/Card';
import { ScreenHeader, Field, Button, ErrorText, Segmented, fmtInr, kit } from '../components/ScreenKit';
import { useAuth } from '../context/AuthContext';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../constants/theme';
import { apiErrorMessage } from '../utils/api';
import { confirmAction } from '../utils/alert';
import { getAccounts, addAccount, updateAccount, deleteAccount, Account, AccountType } from '../utils/database';

const TYPE_OPTIONS: { key: AccountType; label: string }[] = [
  { key: 'bank', label: 'Bank' },
  { key: 'cash', label: 'Cash' },
  { key: 'wallet', label: 'Wallet' },
  { key: 'credit_card', label: 'Card' },
];

const TYPE_ICON: Record<AccountType, keyof typeof Ionicons.glyphMap> = {
  bank: 'business-outline',
  cash: 'cash-outline',
  wallet: 'wallet-outline',
  credit_card: 'card-outline',
};

const TYPE_LABEL: Record<AccountType, string> = { bank: 'Bank account', cash: 'Cash', wallet: 'Wallet / UPI', credit_card: 'Credit card' };

// Where the user's money sits. Balances are typed in (not computed from
// transactions) and count toward net worth in Reports — credit-card dues
// count as money owed.
export default function AccountsScreen() {
  const { user, isLoading } = useAuth();
  const [items, setItems] = useState<Account[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('bank');
  const [balance, setBalance] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Separate from `editing` so the sheet keeps its title while it animates closed.
  const [isNew, setIsNew] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setItems(await getAccounts());
    setLoaded(true);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setLoaded(true));
    }, [load])
  );

  if (isLoading) return null;
  if (!user) return <Redirect href="/login" />;

  const held = items.filter((a) => a.type !== 'credit_card').reduce((s, a) => s + a.balance, 0);
  const owed = items.filter((a) => a.type === 'credit_card').reduce((s, a) => s + a.balance, 0);

  const openNew = () => {
    setEditing('new');
    setIsNew(true);
    setName('');
    setType('bank');
    setBalance('');
    setError(null);
  };

  const openEdit = (a: Account) => {
    setEditing(a);
    setIsNew(false);
    setName(a.name);
    setType(a.type);
    setBalance(String(a.balance));
    setError(null);
  };

  const onSave = async () => {
    const value = balance.trim() === '' ? 0 : Number(balance);
    if (!name.trim()) {
      setError('Give the account a name.');
      return;
    }
    if (!Number.isFinite(value)) {
      setError('Enter the balance as a number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editing === 'new') await addAccount({ name: name.trim(), type, balance: value });
      else if (editing) await updateAccount(editing.id, { name: name.trim(), type, balance: value });
      setEditing(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the account.'));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = () => {
    if (!editing || editing === 'new') return;
    const account = editing;
    confirmAction('Remove account', `Remove "${account.name}"? Your transactions are not affected.`, 'Remove', async () => {
      await deleteAccount(account.id);
      setEditing(null);
      await load();
    });
  };

  return (
    <View style={kit.screen}>
      <ScreenHeader
        title="Accounts"
        right={
          <Pressable style={styles.addBtn} onPress={openNew} accessibilityLabel="Add account">
            <Ionicons name="add" size={22} color="#04140D" />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={kit.content}>
        <Card style={styles.totals}>
          <View style={styles.totalCol}>
            <Text style={kit.muted}>Money held</Text>
            <Text style={[styles.totalValue, { color: COLORS.accent }]}>{fmtInr(held)}</Text>
          </View>
          <View style={styles.totalCol}>
            <Text style={kit.muted}>Card dues</Text>
            <Text style={[styles.totalValue, { color: owed > 0 ? COLORS.red : COLORS.textMuted }]}>{fmtInr(owed)}</Text>
          </View>
        </Card>
        <Text style={kit.dim}>Update balances whenever you check your bank app — they count toward your net worth in Reports.</Text>

        {loaded && items.length === 0 ? (
          <Text style={kit.empty}>No accounts yet. Tap + to add your bank account, cash or a credit card.</Text>
        ) : (
          items.map((a) => (
            <Pressable key={a.id} style={styles.row} onPress={() => openEdit(a)}>
              <Ionicons name={TYPE_ICON[a.type]} size={20} color={COLORS.textMuted} />
              <View style={styles.rowMid}>
                <Text style={styles.rowLabel}>{a.name}</Text>
                <Text style={kit.dim}>{TYPE_LABEL[a.type]}</Text>
              </View>
              <Text style={[styles.rowAmount, { color: a.type === 'credit_card' ? COLORS.red : a.balance < 0 ? COLORS.red : COLORS.text }]}>
                {a.type === 'credit_card' ? '-' : ''}
                {fmtInr(a.balance)}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>

      <Modal visible={editing != null} animationType={MODAL_ANIMATION} transparent onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{isNew ? 'Add account' : 'Edit account'}</Text>
              <Pressable onPress={() => setEditing(null)} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={COLORS.text} />
              </Pressable>
            </View>
            <Segmented options={TYPE_OPTIONS} value={type} onChange={setType} />
            <Field label="Name" value={name} onChangeText={setName} placeholder={type === 'credit_card' ? 'e.g. HDFC Millennia' : 'e.g. SBI Savings'} />
            <Field
              label={type === 'credit_card' ? 'Amount owed' : 'Current balance'}
              value={balance}
              onChangeText={setBalance}
              placeholder="0"
              keyboardType="numbers-and-punctuation"
              hint={type === 'credit_card' ? 'What you currently owe on this card.' : undefined}
            />
            <ErrorText message={error} />
            <Button label={busy ? 'Saving…' : 'Save'} onPress={onSave} disabled={busy} />
            {!isNew && <Button label="Remove account" variant="danger" onPress={onDelete} />}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  addBtn: { backgroundColor: COLORS.accent, width: 34, height: 34, borderRadius: RADIUS.full, alignItems: 'center', justifyContent: 'center' },
  totals: { flexDirection: 'row' },
  totalCol: { flex: 1, gap: 4 },
  totalValue: { fontSize: 20, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
  },
  rowMid: { flex: 1 },
  rowLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  rowAmount: { fontSize: 15, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
});
