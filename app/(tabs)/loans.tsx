import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Modal,
  Switch,
  TextInput,
  KeyboardAvoidingView,
  Platform, ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../../constants/theme';
import { MiniBar } from '../../components/MiniBar';
import { ProGate } from '../../components/ProGate';
import { useAuth } from '../../context/AuthContext';
import { addLoan, deleteLoan, getLoans, updateLoan, payLoanEmi, payLoanPartial, Loan } from '../../utils/database';
import { simulateDebtPayoff, computePartPayment, DebtStrategy, splitEmi, monthsToRepay } from '../../utils/calculations';
import { confirmAction, showAlert } from '../../utils/alert';
import { todayLocalIso, isValidIsoDate } from '../../utils/dates';
import { apiErrorMessage } from '../../utils/api';

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

const LOAN_TYPES = ['home', 'car', 'personal', 'education', 'gold', 'other'] as const;
const LOAN_TYPE_LABEL: Record<string, string> = { home: 'Home', car: 'Car', personal: 'Personal', education: 'Education', gold: 'Gold', other: 'Other' };

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
  const [loanType, setLoanType] = useState<string | null>(null);
  const [lender, setLender] = useState('');
  const [tenure, setTenure] = useState('');
  const [startDate, setStartDate] = useState('');
  const [loanNote, setLoanNote] = useState('');
  const [countsAsExpense, setCountsAsExpense] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [payingId, setPayingId] = useState<number | null>(null);
  const [partLoan, setPartLoan] = useState<Loan | null>(null);
  const [partAmount, setPartAmount] = useState('');
  const [partError, setPartError] = useState<string | null>(null);
  const [partSaving, setPartSaving] = useState(false);
  const [strategy, setStrategy] = useState<DebtStrategy>('snowball');
  const [extraPerMonth, setExtraPerMonth] = useState('');

  const load = useCallback(async () => { if (user) setItems(await getLoans()); }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setEditingId(null);
    setName(''); setPrincipal(''); setOutstanding(''); setEmi(''); setInterestRate(''); setCountsAsExpense(true); setError(null);
    setLoanType(null); setLender(''); setTenure(''); setStartDate(''); setLoanNote('');
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
    setLoanType(loan.loan_type);
    setLender(loan.lender ?? '');
    setTenure(loan.tenure_months != null ? String(loan.tenure_months) : '');
    setStartDate(loan.start_date ?? '');
    setLoanNote(loan.note ?? '');
    setCountsAsExpense(loan.counts_as_expense);
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
    if (r != null && (Number.isNaN(r) || r < 0 || r >= 100)) { setError('Interest rate must be between 0 and 100%.'); return; }
    const t = tenure.trim() ? parseInt(tenure, 10) : null;
    if (t != null && (Number.isNaN(t) || t < 1 || t > 600)) { setError('Tenure must be 1–600 months.'); return; }
    if (startDate.trim() && !isValidIsoDate(startDate.trim())) { setError('Start date must be a real date as YYYY-MM-DD.'); return; }
    const details = {
      interest_rate: r,
      tenure_months: t,
      start_date: startDate.trim() || null,
      loan_type: loanType,
      lender: lender.trim() || null,
      note: loanNote.trim() || null,
    };
    setSaving(true);
    setError(null);
    try {
      if (editingId != null) {
        await updateLoan(editingId, { name: name.trim(), principal: p, outstanding: o, emi: e, counts_as_expense: countsAsExpense, ...details });
      } else {
        await addLoan({ name: name.trim(), principal: p, outstanding: o, emi: e, counts_as_expense: countsAsExpense, ...details });
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

  const onPayEmi = (loan: Loan) => {
    if (!user || payingId != null) return;
    const payment = Math.min(loan.emi, loan.outstanding);
    confirmAction(
      'Mark EMI paid',
      `Record ${fmt(payment)} for ${loan.name}? This lowers the outstanding balance only — this loan is not counted in your expenses.`,
      'Record payment',
      async () => {
        setPayingId(loan.id);
        try {
          await payLoanEmi(loan.id, todayLocalIso());
          await load();
        } catch (err) {
          showAlert('Could not record EMI', apiErrorMessage(err, 'Please try again.'));
        } finally {
          setPayingId(null);
        }
      }
    );
  };

  const openPart = (loan: Loan) => {
    setPartLoan(loan);
    setPartAmount('');
    setPartError(null);
  };

  const closePart = () => {
    setPartLoan(null);
    setPartAmount('');
    setPartError(null);
  };

  const onSavePart = async () => {
    if (!partLoan) return;
    const amount = parseFloat(partAmount);
    if (!amount || amount <= 0) { setPartError('Enter the amount you are paying.'); return; }
    if (amount > partLoan.outstanding) { setPartError(`Amount can't exceed the outstanding balance (${fmt(partLoan.outstanding)}).`); return; }
    setPartSaving(true);
    setPartError(null);
    try {
      await payLoanPartial(partLoan.id, amount, todayLocalIso());
      closePart();
      await load();
    } catch (err) {
      setPartError(apiErrorMessage(err, 'Could not record the part payment.'));
    } finally {
      setPartSaving(false);
    }
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
          <Ionicons name="add" size={22} color={COLORS.onAccent} />
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
          const monthsLeft = monthsToRepay(item.outstanding, item.interest_rate, item.emi);
          const nextSplit = item.interest_rate ? splitEmi(item.outstanding, item.interest_rate, item.emi) : null;
          const subtitle = [item.loan_type ? LOAN_TYPE_LABEL[item.loan_type] ?? item.loan_type : null, item.lender, item.interest_rate != null ? `${item.interest_rate}%` : null]
            .filter(Boolean)
            .join(' · ');
          return (
            <Pressable style={styles.card} onPress={() => openEdit(item)}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleWrap}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  {!item.counts_as_expense && <Text style={styles.notExpenseChip}>Not in expenses</Text>}
                  {subtitle ? <Text style={styles.cardMuted}>{subtitle}</Text> : null}
                </View>
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
                {item.outstanding > 0 && <Text style={styles.cardMuted}>{monthsLeft == null ? "EMI doesn't cover interest" : `${monthsLeft} mo left`}</Text>}
              </View>
              {nextSplit && item.outstanding > 0 && (
                <Text style={styles.cardMuted}>
                  Next EMI: {fmt(nextSplit.interest)} interest · {fmt(nextSplit.principal)} principal
                </Text>
              )}
              {item.outstanding > 0 ? (
                <View style={styles.payRow}>
                  {item.counts_as_expense ? (
                    <Text style={[styles.cardMuted, styles.payBtnFlex, styles.autoNote]}>EMI recorded and balance reduced automatically each month</Text>
                  ) : (
                    <Pressable
                      style={[styles.payBtn, styles.payBtnFlex, payingId != null && styles.payBtnDisabled]}
                      disabled={payingId != null}
                      onPress={(e) => {
                        e.stopPropagation();
                        onPayEmi(item);
                      }}
                    >
                      <Text style={styles.payBtnText}>{payingId === item.id ? 'Recording…' : 'Mark EMI paid'}</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={[styles.payBtn, styles.payBtnFlex, payingId != null && styles.payBtnDisabled]}
                    disabled={payingId != null}
                    onPress={(e) => {
                      e.stopPropagation();
                      openPart(item);
                    }}
                  >
                    <Text style={styles.payBtnText}>Part payment</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.paidOffText}>Fully paid off</Text>
              )}
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

            <ScrollView style={styles.formScroll} contentContainerStyle={styles.formScrollContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Loan name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Home loan 1" placeholderTextColor={COLORS.textDim} />

            <Text style={styles.label}>Principal amount</Text>
            <TextInput style={styles.input} value={principal} onChangeText={setPrincipal} placeholder="0" placeholderTextColor={COLORS.textDim} keyboardType="numeric" />

            <Text style={styles.label}>Outstanding amount</Text>
            <TextInput style={styles.input} value={outstanding} onChangeText={setOutstanding} placeholder="0" placeholderTextColor={COLORS.textDim} keyboardType="numeric" />

            <Text style={styles.label}>Monthly EMI</Text>
            <TextInput style={styles.input} value={emi} onChangeText={setEmi} placeholder="0" placeholderTextColor={COLORS.textDim} keyboardType="numeric" />

            <Text style={styles.label}>Interest rate % per year (optional)</Text>
            <TextInput style={styles.input} value={interestRate} onChangeText={setInterestRate} placeholder="e.g. 8.5" placeholderTextColor={COLORS.textDim} keyboardType="numeric" />
            <Text style={styles.toggleHint}>Used to split each EMI into interest and principal. Without it the whole EMI reduces the balance.</Text>

            <Text style={styles.label}>Loan type (optional)</Text>
            <View style={styles.chipRow}>
              {LOAN_TYPES.map((t) => (
                <Pressable key={t} style={[styles.typeChip, loanType === t && styles.typeChipActive]} onPress={() => setLoanType(loanType === t ? null : t)}>
                  <Text style={[styles.typeChipText, loanType === t && styles.typeChipTextActive]}>{LOAN_TYPE_LABEL[t]}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Lender (optional)</Text>
            <TextInput style={styles.input} value={lender} onChangeText={setLender} placeholder="e.g. SBI" placeholderTextColor={COLORS.textDim} />

            <View style={styles.twoCol}>
              <View style={styles.col}>
                <Text style={styles.label}>Tenure, months</Text>
                <TextInput style={styles.input} value={tenure} onChangeText={setTenure} placeholder="e.g. 240" placeholderTextColor={COLORS.textDim} keyboardType="number-pad" />
              </View>
              <View style={styles.col}>
                <Text style={styles.label}>Start date</Text>
                <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" placeholderTextColor={COLORS.textDim} />
              </View>
            </View>

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput style={styles.input} value={loanNote} onChangeText={setLoanNote} placeholder="Anything to remember" placeholderTextColor={COLORS.textDim} />

            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>Add monthly EMI to expenses</Text>
                <Text style={styles.toggleHint}>
                  {countsAsExpense
                    ? "Each month's EMI is added to expenses and the balance goes down by its principal part, automatically. Enter the balance as it is today."
                    : 'No EMI is added to expenses — tap "Mark EMI paid" when you pay. The balance still counts as debt in Reports.'}
                </Text>
              </View>
              <Switch
                value={countsAsExpense}
                onValueChange={setCountsAsExpense}
                trackColor={{ false: COLORS.cardBorder, true: COLORS.accent }}
                thumbColor="#FFFFFF"
              />
            </View>

            </ScrollView>

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable style={styles.saveBtn} onPress={onSave} disabled={saving}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : editingId != null ? 'Save changes' : 'Save loan'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={partLoan != null} animationType={MODAL_ANIMATION} transparent onRequestClose={closePart}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Part payment{partLoan ? ` · ${partLoan.name}` : ''}</Text>
              <Pressable onPress={closePart}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </Pressable>
            </View>

            {partLoan && (() => {
              const amount = parseFloat(partAmount);
              const valid = amount > 0 && amount <= partLoan.outstanding;
              const next = valid ? computePartPayment(partLoan, amount) : null;
              return (
                <>
                  <Text style={styles.plannerHint}>
                    Outstanding {fmt(partLoan.outstanding)} · EMI {fmt(partLoan.emi)}/mo. The EMI is reduced in the same proportion, so the loan still ends on the same schedule.
                  </Text>

                  <Text style={styles.label}>Amount paying now</Text>
                  <TextInput
                    style={styles.input}
                    value={partAmount}
                    onChangeText={setPartAmount}
                    placeholder="0"
                    placeholderTextColor={COLORS.textDim}
                    keyboardType="numeric"
                    autoFocus
                  />

                  {next && (
                    <View style={styles.previewBox}>
                      <View style={styles.cardFooter}>
                        <Text style={styles.cardMuted}>New outstanding</Text>
                        <Text style={styles.previewValue}>{fmt(next.outstanding)}</Text>
                      </View>
                      <View style={styles.cardFooter}>
                        <Text style={styles.cardMuted}>New EMI</Text>
                        <Text style={styles.previewValue}>{next.monthsLeft == null ? 'Loan closed' : `${fmt(next.emi)}/mo`}</Text>
                      </View>
                      {next.monthsLeft != null && (
                        <View style={styles.cardFooter}>
                          <Text style={styles.cardMuted}>Instalments left</Text>
                          <Text style={styles.previewValue}>{next.monthsLeft} mo</Text>
                        </View>
                      )}
                    </View>
                  )}

                  <Text style={styles.toggleHint}>
                    {partLoan.counts_as_expense
                      ? "This payment will be added to this month's expenses."
                      : 'This loan is not counted in expenses, so only the balance changes.'}
                  </Text>
                </>
              );
            })()}

            {partError && <Text style={styles.error}>{partError}</Text>}

            <Pressable style={styles.saveBtn} onPress={onSavePart} disabled={partSaving}>
              <Text style={styles.saveBtnText}>{partSaving ? 'Recording…' : 'Record part payment'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  formScroll: { maxHeight: 460 },
  formScrollContent: { gap: SPACING.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  typeChip: { borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 6 },
  typeChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  typeChipText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  typeChipTextActive: { color: COLORS.onAccent },
  twoCol: { flexDirection: 'row', gap: SPACING.sm },
  col: { flex: 1, gap: SPACING.xs },
  autoNote: { alignSelf: 'center', fontSize: 11.5 },
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
  cardTitleWrap: { flexShrink: 1, gap: 2 },
  notExpenseChip: { color: COLORS.textMuted, fontSize: 11 },
  cardEmi: { color: COLORS.blue, fontSize: 13, fontWeight: '600' },
  cardDeleteBtn: { padding: 2 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  cardMuted: { color: COLORS.textMuted, fontSize: 12 },
  payBtn: { backgroundColor: `${COLORS.blue}22`, borderRadius: RADIUS.sm, paddingVertical: 8, alignItems: 'center' },
  payBtnText: { color: COLORS.blue, fontWeight: '600', fontSize: 13 },
  payBtnDisabled: { opacity: 0.5 },
  payRow: { flexDirection: 'row', gap: SPACING.sm },
  payBtnFlex: { flex: 1 },
  previewBox: { backgroundColor: COLORS.card, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md, gap: SPACING.xs },
  previewValue: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  paidOffText: { color: COLORS.accent, fontSize: 13, fontWeight: '600', textAlign: 'center', paddingVertical: 8 },
  modalBackdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'flex-end' },
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
  typeBtnTextActive: { color: COLORS.onAccent },
  catRow: { paddingVertical: SPACING.sm },
  catRowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  input: { backgroundColor: COLORS.input, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.text, fontSize: 15 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.md, marginTop: SPACING.sm },
  toggleText: { flex: 1 },
  toggleLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  toggleHint: { color: COLORS.textDim, fontSize: 12, marginTop: 2 },
  error: { color: COLORS.red, fontSize: 13 },
  saveBtn: { backgroundColor: COLORS.accent, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center', marginTop: SPACING.sm },
  saveBtnText: { color: COLORS.onAccent, fontWeight: '700', fontSize: 16 },
});
