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
  ScrollView,
  Switch,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { addInvestment, updateInvestment, deleteInvestment, getInvestments, Investment } from '../../utils/database';
import { confirmAction } from '../../utils/alert';
import { apiErrorMessage } from '../../utils/api';
import { AmountText } from '../../components/AmountText';
import { withFeature } from '../../components/FeatureGate';
import { parseAmount } from '../../utils/amount';
import { DateInput } from '../../components/DateInput';
import { EXPENSE_CATEGORIES } from '../../constants/categories';
import { DEFAULT_SIP_CATEGORY, SIP_CATEGORIES, SipCategory, SipInput, ordinalDay } from '../../utils/sip';
import { isValidIsoDate, todayLocalIso } from '../../utils/dates';

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

const INVESTMENT_TYPES = ['Mutual fund', 'Fixed deposit', 'Bonds', 'Gold', 'Chit fund (BC)', 'Other'];

const categoryLabel = (key: string) => EXPENSE_CATEGORIES.find((c) => c.key === key)?.label ?? key;
const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const shortDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function InvestmentsScreen() {
  const { user } = useAuth();
  const [items, setItems] = useState<Investment[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState(INVESTMENT_TYPES[0]);
  const [amount, setAmount] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // SIP: a fixed amount invested every month, added to Transactions on its day each month.
  const [sipOn, setSipOn] = useState(false);
  const [sipAmount, setSipAmount] = useState('');
  const [sipDay, setSipDay] = useState('');
  const [sipEnd, setSipEnd] = useState<'none' | 'date'>('none');
  const [sipEndDate, setSipEndDate] = useState('');
  const [sipCategory, setSipCategory] = useState<SipCategory>(DEFAULT_SIP_CATEGORY);

  const load = useCallback(async () => { if (user) setItems(await getInvestments()); }, [user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setEditingId(null);
    setName(''); setType(INVESTMENT_TYPES[0]); setAmount(''); setCurrentValue(''); setError(null);
    setSipOn(false); setSipAmount(''); setSipDay(''); setSipEnd('none'); setSipEndDate(''); setSipCategory(DEFAULT_SIP_CATEGORY);
  };

  const openAdd = () => {
    resetForm();
    setModalOpen(true);
  };

  const openEdit = (item: Investment) => {
    setEditingId(item.id);
    setName(item.name);
    setType(item.type);
    setAmount(String(item.amount));
    setCurrentValue(item.current_value != null ? String(item.current_value) : '');
    setError(null);
    const hasSip = item.sip_amount != null;
    setSipOn(hasSip);
    setSipAmount(hasSip ? String(item.sip_amount) : '');
    setSipDay(hasSip && item.sip_day != null ? String(item.sip_day) : '');
    setSipEnd(item.sip_ends_on ? 'date' : 'none');
    setSipEndDate(item.sip_ends_on ?? '');
    setSipCategory(item.sip_category && (SIP_CATEGORIES as readonly string[]).includes(item.sip_category) ? (item.sip_category as SipCategory) : DEFAULT_SIP_CATEGORY);
    setModalOpen(true);
  };

  const totalInvested = items.reduce((s, i) => s + i.amount, 0);
  const totalCurrent = items.reduce((s, i) => s + (i.current_value ?? i.amount), 0);
  const overallGainPct = totalInvested > 0 ? ((totalCurrent - totalInvested) / totalInvested) * 100 : 0;

  const onSave = async () => {
    if (!user) return;
    const amt = parseAmount(amount);
    const cur = currentValue.trim() ? parseAmount(currentValue) : amt;
    if (!name.trim()) { setError('Enter an investment name.'); return; }
    if (!amt || amt <= 0) { setError('Enter a valid invested amount.'); return; }
    if (Number.isNaN(cur)) { setError('Enter a valid current value.'); return; }
    let sip: SipInput | null = null;
    if (sipOn) {
      const sipAmt = parseAmount(sipAmount);
      const day = Number(sipDay);
      if (!sipAmt || sipAmt <= 0) { setError('Enter the SIP amount.'); return; }
      if (!Number.isInteger(day) || day < 1 || day > 31) { setError('Enter the SIP day as a number from 1 to 31.'); return; }
      if (sipEnd === 'date') {
        if (!isValidIsoDate(sipEndDate)) { setError('Enter the SIP end date as YYYY-MM-DD, or choose No end date.'); return; }
        if (sipEndDate < todayLocalIso()) { setError("The SIP's end date can't be in the past."); return; }
      }
      sip = { amount: sipAmt, day, category: sipCategory, ...(sipEnd === 'date' ? { ends_on: sipEndDate } : { no_end: true }) };
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId != null) {
        // sip: null stops a SIP the investment had; an object starts or changes it.
        await updateInvestment(editingId, { name: name.trim(), type, amount: amt, current_value: cur, sip });
      } else {
        await addInvestment({
          name: name.trim(),
          type,
          amount: amt,
          current_value: cur,
          start_date: new Date().toISOString().slice(0, 10),
          maturity_date: null,
          returns_percent: null,
          note: null,
        }, sip);
      }
      resetForm();
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the investment.'));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = (id: number) => {
    confirmAction('Delete investment', 'Remove this investment?', 'Delete', async () => {
      await deleteInvestment(id);
      await load();
    });
  };

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Investments</Text>
        <Pressable style={styles.addBtn} onPress={openAdd}>
          <Ionicons name="add" size={22} color={COLORS.onAccent} />
        </Pressable>
      </View>

      {items.length > 0 && (
        <View style={styles.summaryCard}>
          <View style={styles.summaryCol}>
            <Text style={styles.cardMuted}>Invested</Text>
            <AmountText value={totalInvested} style={styles.summaryValue}>{fmt(totalInvested)}</AmountText>
          </View>
          <View style={styles.summaryCol}>
            <Text style={styles.cardMuted}>Current value</Text>
            <AmountText value={totalCurrent} style={styles.summaryValue}>{fmt(totalCurrent)}</AmountText>
          </View>
          <View style={styles.summaryCol}>
            <Text style={styles.cardMuted}>Gain</Text>
            <Text style={[styles.summaryValue, { color: overallGainPct >= 0 ? COLORS.accent : COLORS.red }]}>
              {overallGainPct >= 0 ? '+' : ''}{overallGainPct.toFixed(1)}%
            </Text>
          </View>
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.emptyText}>No investments yet. Tap + to add one.</Text>}
        renderItem={({ item }) => {
          const gain = item.returns_percent ?? 0;
          return (
            <Pressable style={styles.card} onPress={() => openEdit(item)}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={styles.cardMuted}>{item.type}</Text>
                  {item.sip_amount != null && item.sip_day != null ? (
                    <View style={styles.sipBadge}>
                      <Text style={styles.sipBadgeText}>SIP {fmt(item.sip_amount)} on the {ordinalDay(item.sip_day)}</Text>
                    </View>
                  ) : (
                    <Text style={styles.noSip}>No SIP</Text>
                  )}
                  {item.sip_amount != null && (
                    <Text style={styles.cardMuted}>
                      {item.sip_next_date ? `Next: ${shortDay(item.sip_next_date)}` : 'Ended'}
                      {item.sip_ends_on ? ` · Ends ${longDate(item.sip_ends_on)}` : item.sip_next_date ? ' · No end date' : ''}
                    </Text>
                  )}
                </View>
                <View style={styles.cardHeaderRight}>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.cardTitle}>{fmt(item.current_value ?? item.amount)}</Text>
                    <Text style={[styles.gainText, { color: gain >= 0 ? COLORS.accent : COLORS.red }]}>
                      {gain >= 0 ? '+' : ''}{gain.toFixed(1)}%
                    </Text>
                  </View>
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
            </Pressable>
          );
        }}
      />

      <Modal visible={modalOpen} animationType={MODAL_ANIMATION} transparent onRequestClose={() => { setModalOpen(false); resetForm(); }}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={styles.modalSheet} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingId != null ? 'Edit investment' : 'Add investment'}</Text>
              <Pressable onPress={() => { setModalOpen(false); resetForm(); }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </Pressable>
            </View>

            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. HDFC Small Cap SIP" placeholderTextColor={COLORS.textDim} />

            <Text style={styles.label}>Type</Text>
            <View style={styles.typeGrid}>
              {INVESTMENT_TYPES.map((t) => (
                <Pressable key={t} style={[styles.typeChip, type === t && styles.typeChipActive]} onPress={() => setType(t)}>
                  <Text style={[styles.typeChipText, type === t && styles.typeChipTextActive]}>{t}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Invested amount</Text>
            <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="0" placeholderTextColor={COLORS.textDim} keyboardType="numeric" />

            <Text style={styles.label}>Current value (optional)</Text>
            <TextInput style={styles.input} value={currentValue} onChangeText={setCurrentValue} placeholder="Same as invested if unknown" placeholderTextColor={COLORS.textDim} keyboardType="numeric" />

            <View style={styles.sipRow}>
              <Text style={styles.sipTitle}>I invest here every month (SIP)</Text>
              <Switch value={sipOn} onValueChange={setSipOn} trackColor={{ false: COLORS.cardBorder, true: COLORS.accent }} accessibilityLabel="I invest here every month, SIP" />
            </View>

            {sipOn && (
              <View style={styles.sipBox}>
                <View style={styles.sipPair}>
                  <View style={styles.sipHalf}>
                    <Text style={styles.label}>SIP amount</Text>
                    <TextInput style={styles.input} value={sipAmount} onChangeText={setSipAmount} placeholder="0" placeholderTextColor={COLORS.textDim} keyboardType="numeric" accessibilityLabel="SIP amount" />
                  </View>
                  <View style={styles.sipHalf}>
                    <Text style={styles.label}>Day of month</Text>
                    <TextInput style={styles.input} value={sipDay} onChangeText={setSipDay} placeholder="1 to 31" placeholderTextColor={COLORS.textDim} keyboardType="numeric" maxLength={2} accessibilityLabel="SIP day of month" />
                  </View>
                </View>

                <Text style={styles.label}>Ends</Text>
                <View style={styles.typeGrid}>
                  <Pressable style={[styles.typeChip, sipEnd === 'date' && styles.typeChipActive]} onPress={() => setSipEnd('date')}>
                    <Text style={[styles.typeChipText, sipEnd === 'date' && styles.typeChipTextActive]}>Pick a date</Text>
                  </Pressable>
                  <Pressable style={[styles.typeChip, sipEnd === 'none' && styles.typeChipActive]} onPress={() => setSipEnd('none')}>
                    <Text style={[styles.typeChipText, sipEnd === 'none' && styles.typeChipTextActive]}>No end date</Text>
                  </Pressable>
                </View>
                {sipEnd === 'date' && <DateInput value={sipEndDate} onChange={setSipEndDate} min={todayLocalIso()} inputStyle={styles.input} accessibilityLabel="SIP end date" />}

                <Text style={styles.label}>Added to Transactions as</Text>
                <View style={styles.typeGrid}>
                  {SIP_CATEGORIES.map((c) => (
                    <Pressable key={c} style={[styles.typeChip, sipCategory === c && styles.typeChipActive]} onPress={() => setSipCategory(c)}>
                      <Text style={[styles.typeChipText, sipCategory === c && styles.typeChipTextActive]}>{categoryLabel(c)}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.sipHint}>Each month it is added to Transactions on that day and to the invested amount and current value. Already repeat this in Transactions? Remove that repeat so it isn't added twice.</Text>
              </View>
            )}

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable style={styles.saveBtn} onPress={onSave} disabled={saving}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : editingId != null ? 'Save changes' : 'Save investment'}</Text>
            </Pressable>
          </ScrollView>
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
  summaryCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginHorizontal: SPACING.lg,
  },
  summaryCol: { flex: 1, minWidth: 0 },
  summaryValue: { color: COLORS.text, fontSize: 16, fontWeight: '700', marginTop: 2 },
  listContent: { padding: SPACING.lg, gap: SPACING.sm },
  emptyText: { color: COLORS.textDim, fontSize: 13, textAlign: 'center', marginTop: SPACING.xl },
  card: { backgroundColor: COLORS.card, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: SPACING.sm },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm },
  cardDeleteBtn: { padding: 2 },
  cardTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  cardMuted: { color: COLORS.textMuted, fontSize: 12, marginTop: 2, flexShrink: 1 },
  gainText: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  modalBackdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, maxHeight: '92%', flexGrow: 0 },
  modalContent: { padding: SPACING.lg, gap: SPACING.sm },
  sipRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.cardBorder, paddingTop: SPACING.sm, marginTop: SPACING.xs },
  sipTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  sipBox: { gap: SPACING.xs },
  sipPair: { flexDirection: 'row', gap: SPACING.sm },
  sipHalf: { flex: 1 },
  sipHint: { color: COLORS.textDim, fontSize: 12 },
  sipBadge: { alignSelf: 'flex-start', backgroundColor: COLORS.accent + '22', borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 2, marginTop: 4 },
  sipBadgeText: { color: COLORS.accent, fontSize: 12, fontWeight: '600' },
  noSip: { color: COLORS.textDim, fontSize: 12, marginTop: 4 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  modalTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  label: { color: COLORS.textMuted, fontSize: 13, marginTop: SPACING.xs },
  input: { backgroundColor: COLORS.input, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.text, fontSize: 15 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  typeChip: { borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 6 },
  typeChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  typeChipText: { color: COLORS.textMuted, fontSize: 12 },
  typeChipTextActive: { color: COLORS.onAccent, fontWeight: '600' },
  error: { color: COLORS.red, fontSize: 13 },
  saveBtn: { backgroundColor: COLORS.accent, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center', marginTop: SPACING.sm },
  saveBtnText: { color: COLORS.onAccent, fontWeight: '700', fontSize: 16 },
});

// Staff switch this feature on per user; without it the screen is replaced by a "request access" page.
export default withFeature('investments', InvestmentsScreen);
