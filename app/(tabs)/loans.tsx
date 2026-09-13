import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../../constants/theme';
import { MiniBar } from '../../components/MiniBar';
import { ProGate } from '../../components/ProGate';
import { useAuth } from '../../context/AuthContext';
import { addLoan, deleteLoan, getLoans, updateLoan, Loan } from '../../utils/database';
import { simulateDebtPayoff, DebtStrategy } from '../../utils/calculations';
import { confirmAction } from '../../utils/alert';
import { apiErrorMessage } from '../../utils/api';

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function LoansScreen() {
  const { user } = useAuth();
  const [items, setItems] = useState<Loan[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [principal, setPrincipal] = useState('');
  const [outstanding, setOutstanding] = useState('');
  const [emi, setEmi] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [strategy, setStrategy] = useState<DebtStrategy>('snowball');
  const [extraPerMonth, setExtraPerMonth] = useState('');

  const load = useCallback(async () => { if (user) setItems(await getLoans()); }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setEditingId(null);
    setName(''); setPrincipal(''); setOutstanding(''); setEmi(''); setInterestRate(''); setError(null);
  };

  const openAdd = () => {
    resetForm();
    setModalOpen(true);
  };

  const openEdit = (loan: Loan) => {
    setEditingId(loan.id);
    setName(loan.name);
    setPrincipal(String(loan.principal));
    setOutstanding(String(loan.outstanding));
    setEmi(String(loan.emi));
    setInterestRate(loan.interest_rate != null ? String(loan.interest_rate) : '');
    setError(null);
    setModalOpen(true);
  };

  const onSave = async () => {
    if (!user) return;
    const p = parseFloat(principal);
    const o = parseFloat(outstanding);
    const e = parseFloat(emi);
    const r = interestRate ? parseFloat(interestRate) : null;
    if (!name.trim()) { setError('Enter a loan name.'); return; }
    if (!p || !o || !e) { setError('Enter valid principal, outstanding, and EMI amounts.'); return; }
    setSaving(true);
    setError(null);
    try {
      if (editingId != null) {
        await updateLoan(editingId, { name: name.trim(), principal: p, outstanding: o, emi: e, interest_rate: r });
      } else {
        await addLoan({
          name: name.trim(),
          principal: p,
          outstanding: o,
          emi: e,
          interest_rate: r,
          tenure_months: null,
          start_date: null,
          loan_type: null,
          lender: null,
          note: null,
        });
      }
      resetForm();
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the loan.'));
    } finally {
      setSaving(false);
    }
  };

  const onPayEmi = async (loan: Loan) => {
    if (!user) return;
    const next = Math.max(0, loan.outstanding - loan.emi);
    await updateLoan(loan.id, { outstanding: next });
    await load();
  };

  const onDelete = (id: number) => {
    confirmAction('Delete loan', 'Remove this loan?', 'Delete', async () => {
      await deleteLoan(id);
      await load();
    });
  };

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Loans & EMIs</Text>
        <Pressable style={styles.addBtn} onPress={openAdd}>
          <Ionicons name="add" size={22} color="#04140D" />
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.emptyText}>No loans tracked yet. Tap + to add one.</Text>}
        ListFooterComponent={
          items.length === 0 ? null : (
            <View style={{ marginTop: SPACING.md }}>
              <Text style={styles.sectionTitle}>Debt payoff planner</Text>
              <ProGate
                title="Payoff timeline"
                description="See which loan clears first and when you'd be debt-free — available on Pro."
              >
                <View style={styles.plannerCard}>
                  <View style={styles.typeToggle}>
                    {(['snowball', 'avalanche'] as DebtStrategy[]).map((s) => (
                      <Pressable key={s} style={[styles.typeBtn, strategy === s && styles.typeBtnActive]} onPress={() => setStrategy(s)}>
                        <Text style={[styles.typeBtnText, strategy === s && styles.typeBtnTextActive]}>
                          {s === 'snowball' ? 'Snowball' : 'Avalanche'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.plannerHint}>
                    {strategy === 'snowball'
                      ? 'Smallest balance first, for quick wins and momentum.'
                      : 'Highest interest rate first, for the lowest total interest paid.'}
                  </Text>

                  <Text style={styles.label}>Extra per month (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={extraPerMonth}
                    onChangeText={setExtraPerMonth}
                    placeholder="0"
                    placeholderTextColor={COLORS.textDim}
                    keyboardType="numeric"
                  />

                  {simulateDebtPayoff(items, strategy, parseFloat(extraPerMonth) || 0).map((r, idx) => (
                    <View key={r.loanId} style={[styles.catRow, idx !== 0 && styles.catRowBorder]}>
                      <View style={styles.cardHeader}>
                        <Text style={styles.cardMuted}>{idx + 1}. {r.name}</Text>
                        <Text style={styles.cardMuted}>{r.payoffMonths} mo · {r.payoffDate}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </ProGate>
            </View>
          )
        }
        renderItem={({ item }) => {
          const percentPaid = item.principal > 0 ? ((item.principal - item.outstanding) / item.principal) * 100 : 0;
          const monthsLeft = item.emi > 0 ? Math.ceil(item.outstanding / item.emi) : null;
          return (
            <Pressable style={styles.card} onPress={() => openEdit(item)}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <View style={styles.cardHeaderRight}>
                  <Text style={styles.cardEmi}>{fmt(item.emi)}/mo</Text>
                  <Pressable
                    hitSlop={8}
                    style={styles.cardDeleteBtn}
                    onPress={(e) => {
                      e.stopPropagation();
                      onDelete(item.id);
                    }}
                  >
                    <Ionicons name="trash-outline" size={16} color={COLORS.red} />
                  </Pressable>
                </View>
              </View>
              <MiniBar percent={percentPaid} color={COLORS.blue} />
              <View style={styles.cardFooter}>
                <Text style={styles.cardMuted}>Outstanding {fmt(item.outstanding)} of {fmt(item.principal)}</Text>
                {monthsLeft != null && <Text style={styles.cardMuted}>{monthsLeft} mo left</Text>}
              </View>
              <Pressable
                style={styles.payBtn}
                onPress={(e) => {
                  e.stopPropagation();
                  onPayEmi(item);
                }}
              >
                <Text style={styles.payBtnText}>Mark EMI paid</Text>
              </Pressable>
            </Pressable>
          );
        }}
      />

      <Modal visible={modalOpen} animationType={MODAL_ANIMATION} transparent onRequestClose={() => { setModalOpen(false); resetForm(); }}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingId != null ? 'Edit loan' : 'Add loan'}</Text>
              <Pressable onPress={() => { setModalOpen(false); resetForm(); }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </Pressable>
            </View>

            <Text style={styles.label}>Loan name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Home loan 1" placeholderTextColor={COLORS.textDim} />

            <Text style={styles.label}>Principal amount</Text>
            <TextInput style={styles.input} value={principal} onChangeText={setPrincipal} placeholder="0" placeholderTextColor={COLORS.textDim} keyboardType="numeric" />

            <Text style={styles.label}>Outstanding amount</Text>
            <TextInput style={styles.input} value={outstanding} onChangeText={setOutstanding} placeholder="0" placeholderTextColor={COLORS.textDim} keyboardType="numeric" />

            <Text style={styles.label}>Monthly EMI</Text>
            <TextInput style={styles.input} value={emi} onChangeText={setEmi} placeholder="0" placeholderTextColor={COLORS.textDim} keyboardType="numeric" />

            <Text style={styles.label}>Interest rate % (optional)</Text>
            <TextInput style={styles.input} value={interestRate} onChangeText={setInterestRate} placeholder="e.g. 8.5" placeholderTextColor={COLORS.textDim} keyboardType="numeric" />

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable style={styles.saveBtn} onPress={onSave} disabled={saving}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : editingId != null ? 'Save changes' : 'Save loan'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.lg, paddingBottom: SPACING.sm },
  headerTitle: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  addBtn: { backgroundColor: COLORS.accent, width: 36, height: 36, borderRadius: RADIUS.full, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: SPACING.lg, paddingTop: SPACING.sm, gap: SPACING.sm },
  emptyText: { color: COLORS.textDim, fontSize: 13, textAlign: 'center', marginTop: SPACING.xl },
  card: { backgroundColor: COLORS.card, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md, gap: SPACING.sm },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  cardTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  cardEmi: { color: COLORS.blue, fontSize: 13, fontWeight: '600' },
  cardDeleteBtn: { padding: 2 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  cardMuted: { color: COLORS.textMuted, fontSize: 12 },
  payBtn: { backgroundColor: `${COLORS.blue}22`, borderRadius: RADIUS.sm, paddingVertical: 8, alignItems: 'center' },
  payBtnText: { color: COLORS.blue, fontWeight: '600', fontSize: 13 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  modalTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  label: { color: COLORS.textMuted, fontSize: 13, marginTop: SPACING.xs },
  sectionTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginBottom: SPACING.sm },
  plannerCard: { backgroundColor: COLORS.card, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md, gap: SPACING.xs },
  plannerHint: { color: COLORS.textDim, fontSize: 12, marginBottom: SPACING.xs },
  typeToggle: { flexDirection: 'row', backgroundColor: COLORS.input, borderRadius: RADIUS.md, padding: 4 },
  typeBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: RADIUS.sm },
  typeBtnActive: { backgroundColor: COLORS.accent },
  typeBtnText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 13 },
  typeBtnTextActive: { color: '#04140D' },
  catRow: { paddingVertical: SPACING.sm },
  catRowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  input: { backgroundColor: COLORS.input, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.text, fontSize: 15 },
  error: { color: COLORS.red, fontSize: 13 },
  saveBtn: { backgroundColor: COLORS.accent, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center', marginTop: SPACING.sm },
  saveBtnText: { color: '#04140D', fontWeight: '700', fontSize: 16 },
});
