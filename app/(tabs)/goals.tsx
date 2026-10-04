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
import { MiniBar } from '../../components/MiniBar';
import { ProGate } from '../../components/ProGate';
import { useAuth } from '../../context/AuthContext';
import {
  addGoal,
  updateGoal,
  deleteGoal,
  getGoals,
  getMonthlySeriesForRange,
  contributeToGoal,
  getGoalContributions,
  SavingsGoal,
  GoalContribution,
} from '../../utils/database';
import { computeGoalETA } from '../../utils/calculations';
import { confirmAction } from '../../utils/alert';
import { apiErrorMessage } from '../../utils/api';

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function GoalsScreen() {
  const { user } = useAuth();
  const [items, setItems] = useState<SavingsGoal[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [contributeFor, setContributeFor] = useState<SavingsGoal | null>(null);
  const [contributeAmount, setContributeAmount] = useState('');
  const [contributeMode, setContributeMode] = useState<'add' | 'remove'>('add');
  const [contributeError, setContributeError] = useState<string | null>(null);
  const [contributeSaving, setContributeSaving] = useState(false);
  const [history, setHistory] = useState<GoalContribution[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [avgMonthlySavings, setAvgMonthlySavings] = useState(0);

  const load = useCallback(async () => {
    if (!user) return;
    setItems(await getGoals());
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const series = await getMonthlySeriesForRange(start.getMonth() + 1, start.getFullYear(), now.getMonth() + 1, now.getFullYear());
    setAvgMonthlySavings(series.length ? series.reduce((s: number, p: { net: number }) => s + p.net, 0) / series.length : 0);
  }, [user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => { setEditingId(null); setName(''); setTarget(''); setDeadline(''); setError(null); };

  const openAdd = () => {
    resetForm();
    setModalOpen(true);
  };

  const openEdit = (goal: SavingsGoal) => {
    setEditingId(goal.id);
    setName(goal.name);
    setTarget(String(goal.target_amount));
    setDeadline(goal.deadline ?? '');
    setError(null);
    setModalOpen(true);
  };

  const onSave = async () => {
    if (!user) return;
    const t = parseFloat(target);
    const deadlineTrimmed = deadline.trim();
    if (!name.trim()) { setError('Enter a goal name.'); return; }
    if (!t || t <= 0) { setError('Enter a valid target amount.'); return; }
    if (deadlineTrimmed && (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineTrimmed) || Number.isNaN(new Date(deadlineTrimmed).getTime()))) {
      setError('Enter the target date as YYYY-MM-DD, or leave it blank.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId != null) {
        await updateGoal(editingId, { name: name.trim(), target_amount: t, deadline: deadlineTrimmed || null });
      } else {
        await addGoal({
          name: name.trim(),
          target_amount: t,
          saved_amount: 0,
          deadline: deadlineTrimmed || null,
          color: '',
          icon: 'star',
          note: null,
        });
      }
      resetForm();
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the goal.'));
    } finally {
      setSaving(false);
    }
  };

  const openContribute = (goal: SavingsGoal) => {
    setContributeFor(goal);
    setContributeAmount('');
    setContributeMode('add');
    setContributeError(null);
    setHistory([]);
    setHistoryLoading(true);
    getGoalContributions(goal.id)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  };

  const onContribute = async () => {
    if (!contributeFor || !user) return;
    const amt = parseFloat(contributeAmount);
    if (!amt || amt <= 0) { setContributeError('Enter a valid amount.'); return; }
    if (contributeMode === 'remove' && amt > contributeFor.saved_amount) {
      setContributeError(`You can remove at most ${fmt(contributeFor.saved_amount)}.`);
      return;
    }
    setContributeSaving(true);
    setContributeError(null);
    try {
      const { goal, contribution } = await contributeToGoal(contributeFor.id, amt, contributeMode);
      setContributeFor(goal);
      setContributeAmount('');
      setHistory((h) => [contribution, ...h]);
      setItems((prev) => prev.map((g) => (g.id === goal.id ? goal : g)));
    } catch (err) {
      setContributeError(apiErrorMessage(err, 'Could not update the goal.'));
    } finally {
      setContributeSaving(false);
    }
  };

  const onDelete = (id: number) => {
    confirmAction('Delete goal', 'Remove this savings goal?', 'Delete', async () => {
      await deleteGoal(id);
      await load();
    });
  };

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Savings goals</Text>
        <Pressable style={styles.addBtn} onPress={openAdd}>
          <Ionicons name="add" size={22} color={COLORS.onAccent} />
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.emptyText}>No goals yet. Tap + to add one.</Text>}
        ListFooterComponent={
          items.length === 0 ? null : (
            <View style={{ marginTop: SPACING.md }}>
              <Text style={styles.sectionTitleStandalone}>Goal ETA</Text>
              <ProGate
                title="Goal ETA & payoff insights"
                description="Projected completion dates based on your average monthly savings — available on Pro."
              >
                <View style={styles.plannerCard}>
                  <Text style={styles.cardMuted}>
                    Based on your average net savings of {fmt(avgMonthlySavings)}/mo over the last 3 months
                  </Text>
                  {items.map((g, idx) => {
                    const eta = computeGoalETA(g, avgMonthlySavings);
                    const label = eta.monthsRemaining == null
                      ? 'Not projectable yet (no positive savings trend)'
                      : eta.monthsRemaining === 0
                        ? 'Already reached'
                        : `${eta.monthsRemaining} mo · ${eta.etaDate}`;
                    return (
                      <View key={g.id} style={[styles.etaRow, idx !== 0 && styles.catRowBorder]}>
                        <Text style={styles.cardLabel}>{g.name}</Text>
                        <Text style={styles.cardMuted}>{label}</Text>
                      </View>
                    );
                  })}
                </View>
              </ProGate>
            </View>
          )
        }
        renderItem={({ item }) => {
          const pct = item.target_amount > 0 ? (item.saved_amount / item.target_amount) * 100 : 0;
          const achieved = item.target_amount > 0 && item.saved_amount >= item.target_amount;
          const overdue = !achieved && !!item.deadline && item.deadline < todayIso;
          return (
            <Pressable style={styles.card} onPress={() => openEdit(item)}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <View style={styles.cardHeaderRight}>
                  <Text style={styles.cardPct}>{Math.min(100, pct).toFixed(0)}%</Text>
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
              {(item.deadline || achieved || overdue) && (
                <View style={styles.metaRow}>
                  <Text style={styles.cardMuted}>
                    {item.deadline
                      ? `Target date: ${new Date(item.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                      : ''}
                  </Text>
                  {achieved && (
                    <View style={styles.badge}>
                      <Ionicons name="checkmark-circle" size={12} color={COLORS.accent} />
                      <Text style={[styles.badgeText, { color: COLORS.accent }]}>Goal met</Text>
                    </View>
                  )}
                  {overdue && (
                    <View style={styles.badge}>
                      <Ionicons name="alert-circle" size={12} color={COLORS.red} />
                      <Text style={[styles.badgeText, { color: COLORS.red }]}>Overdue</Text>
                    </View>
                  )}
                </View>
              )}
              <MiniBar percent={pct} color={item.color} />
              <View style={styles.cardFooter}>
                <Text style={styles.cardMuted}>{fmt(item.saved_amount)} of {fmt(item.target_amount)}</Text>
                <Pressable
                  style={styles.contributeBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    openContribute(item);
                  }}
                >
                  <Text style={styles.contributeBtnText}>Manage funds</Text>
                </Pressable>
              </View>
            </Pressable>
          );
        }}
      />

      <Modal visible={modalOpen} animationType={MODAL_ANIMATION} transparent onRequestClose={() => { setModalOpen(false); resetForm(); }}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingId != null ? 'Edit goal' : 'Add goal'}</Text>
              <Pressable onPress={() => { setModalOpen(false); resetForm(); }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </Pressable>
            </View>

            <Text style={styles.label}>Goal name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Emergency fund" placeholderTextColor={COLORS.textDim} />

            <Text style={styles.label}>Target amount</Text>
            <TextInput style={styles.input} value={target} onChangeText={setTarget} placeholder="0" placeholderTextColor={COLORS.textDim} keyboardType="numeric" />

            <Text style={styles.label}>Target date (optional)</Text>
            <TextInput style={styles.input} value={deadline} onChangeText={setDeadline} placeholder="YYYY-MM-DD" placeholderTextColor={COLORS.textDim} />

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable style={styles.saveBtn} onPress={onSave} disabled={saving}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : editingId != null ? 'Save changes' : 'Save goal'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!contributeFor} animationType="fade" transparent onRequestClose={() => setContributeFor(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { borderRadius: RADIUS.lg }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{contributeFor?.name}</Text>
              <Pressable onPress={() => setContributeFor(null)}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </Pressable>
            </View>

            <View style={styles.modeToggle}>
              <Pressable
                style={[styles.modeBtn, contributeMode === 'add' && styles.modeBtnActiveAdd]}
                onPress={() => { setContributeMode('add'); setContributeError(null); }}
              >
                <Text style={[styles.modeBtnText, contributeMode === 'add' && styles.modeBtnTextActive]}>Add funds</Text>
              </Pressable>
              <Pressable
                style={[styles.modeBtn, contributeMode === 'remove' && styles.modeBtnActiveRemove]}
                onPress={() => { setContributeMode('remove'); setContributeError(null); }}
              >
                <Text style={[styles.modeBtnText, contributeMode === 'remove' && styles.modeBtnTextActive]}>Remove funds</Text>
              </Pressable>
            </View>

            <Text style={styles.cardMuted}>
              {contributeMode === 'add'
                ? `Currently saved: ${fmt(contributeFor?.saved_amount ?? 0)}`
                : `You can remove up to ${fmt(contributeFor?.saved_amount ?? 0)}`}
            </Text>

            <TextInput
              style={styles.input}
              value={contributeAmount}
              onChangeText={(t) => { setContributeAmount(t); setContributeError(null); }}
              placeholder="Amount"
              placeholderTextColor={COLORS.textDim}
              keyboardType="numeric"
              autoFocus
            />

            {contributeError && <Text style={styles.error}>{contributeError}</Text>}

            <Pressable
              style={[styles.saveBtn, contributeMode === 'remove' && styles.saveBtnRemove]}
              onPress={onContribute}
              disabled={contributeSaving}
            >
              <Text style={styles.saveBtnText}>
                {contributeSaving ? 'Saving…' : contributeMode === 'add' ? 'Add funds' : 'Remove funds'}
              </Text>
            </Pressable>

            <Text style={styles.sectionTitleStandalone}>Recent activity</Text>
            {historyLoading ? (
              <Text style={styles.cardMuted}>Loading…</Text>
            ) : history.length === 0 ? (
              <Text style={styles.cardMuted}>No activity yet.</Text>
            ) : (
              <FlatList
                style={styles.historyList}
                data={history}
                keyExtractor={(h) => String(h.id)}
                renderItem={({ item: h }) => (
                  <View style={styles.historyRow}>
                    <Ionicons
                      name={h.type === 'add' ? 'arrow-up-circle' : 'arrow-down-circle'}
                      size={16}
                      color={h.type === 'add' ? COLORS.accent : COLORS.red}
                    />
                    <Text style={styles.cardLabel}>{h.type === 'add' ? '+' : '−'}{fmt(h.amount)}</Text>
                    <Text style={styles.cardMuted}>
                      {new Date(h.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </Text>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.lg, paddingBottom: SPACING.sm },
  headerTitle: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  addBtn: { backgroundColor: COLORS.accent, width: 36, height: 36, borderRadius: RADIUS.full, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: SPACING.lg, gap: SPACING.sm },
  emptyText: { color: COLORS.textDim, fontSize: 13, textAlign: 'center', marginTop: SPACING.xl },
  card: { backgroundColor: COLORS.card, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md, gap: SPACING.sm, marginBottom: SPACING.sm },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  cardDeleteBtn: { padding: 2 },
  cardTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  cardPct: { color: COLORS.accent, fontSize: 13, fontWeight: '700' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardMuted: { color: COLORS.textMuted, fontSize: 12 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  contributeBtn: { backgroundColor: `${COLORS.accent}22`, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: 6 },
  contributeBtnText: { color: COLORS.accent, fontWeight: '600', fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  modalTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  label: { color: COLORS.textMuted, fontSize: 13, marginTop: SPACING.xs },
  sectionTitleStandalone: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginBottom: SPACING.sm },
  plannerCard: { backgroundColor: COLORS.card, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md, gap: SPACING.xs },
  cardLabel: { color: COLORS.text, fontSize: 13 },
  etaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.sm },
  catRowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  input: { backgroundColor: COLORS.input, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.text, fontSize: 15 },
  error: { color: COLORS.red, fontSize: 13 },
  saveBtn: { backgroundColor: COLORS.accent, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center', marginTop: SPACING.sm },
  saveBtnRemove: { backgroundColor: COLORS.red },
  saveBtnText: { color: COLORS.onAccent, fontWeight: '700', fontSize: 16 },
  modeToggle: { flexDirection: 'row', backgroundColor: COLORS.input, borderRadius: RADIUS.md, padding: 4, gap: 4 },
  modeBtn: { flex: 1, borderRadius: RADIUS.sm, paddingVertical: 10, alignItems: 'center' },
  modeBtnActiveAdd: { backgroundColor: `${COLORS.accent}33` },
  modeBtnActiveRemove: { backgroundColor: `${COLORS.red}33` },
  modeBtnText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 13 },
  modeBtnTextActive: { color: COLORS.text },
  historyList: { maxHeight: 160 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
});
