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
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { addInvestment, updateInvestment, deleteInvestment, getInvestments, Investment } from '../../utils/database';
import { confirmAction } from '../../utils/alert';
import { apiErrorMessage } from '../../utils/api';
import { withFeature } from '../../components/FeatureGate';

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

const INVESTMENT_TYPES = ['Mutual fund', 'Fixed deposit', 'Bonds', 'Gold', 'Chit fund (BC)', 'Other'];

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

  const load = useCallback(async () => { if (user) setItems(await getInvestments()); }, [user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setEditingId(null);
    setName(''); setType(INVESTMENT_TYPES[0]); setAmount(''); setCurrentValue(''); setError(null);
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
    setModalOpen(true);
  };

  const totalInvested = items.reduce((s, i) => s + i.amount, 0);
  const totalCurrent = items.reduce((s, i) => s + (i.current_value ?? i.amount), 0);
  const overallGainPct = totalInvested > 0 ? ((totalCurrent - totalInvested) / totalInvested) * 100 : 0;

  const onSave = async () => {
    if (!user) return;
    const amt = parseFloat(amount);
    const cur = currentValue ? parseFloat(currentValue) : amt;
    if (!name.trim()) { setError('Enter an investment name.'); return; }
    if (!amt || amt <= 0) { setError('Enter a valid invested amount.'); return; }
    setSaving(true);
    setError(null);
    try {
      if (editingId != null) {
        await updateInvestment(editingId, { name: name.trim(), type, amount: amt, current_value: cur });
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
        });
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
          <View>
            <Text style={styles.cardMuted}>Invested</Text>
            <Text style={styles.summaryValue}>{fmt(totalInvested)}</Text>
          </View>
          <View>
            <Text style={styles.cardMuted}>Current value</Text>
            <Text style={styles.summaryValue}>{fmt(totalCurrent)}</Text>
          </View>
          <View>
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
          <View style={styles.modalSheet}>
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

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable style={styles.saveBtn} onPress={onSave} disabled={saving}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : editingId != null ? 'Save changes' : 'Save investment'}</Text>
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
  summaryCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginHorizontal: SPACING.lg,
  },
  summaryValue: { color: COLORS.text, fontSize: 16, fontWeight: '700', marginTop: 2 },
  listContent: { padding: SPACING.lg, gap: SPACING.sm },
  emptyText: { color: COLORS.textDim, fontSize: 13, textAlign: 'center', marginTop: SPACING.xl },
  card: { backgroundColor: COLORS.card, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm },
  cardDeleteBtn: { padding: 2 },
  cardTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  cardMuted: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  gainText: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  modalBackdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm },
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
