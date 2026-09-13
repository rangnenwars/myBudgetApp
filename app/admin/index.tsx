import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Modal, Switch, KeyboardAvoidingView, Platform } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { getAdminUsers, updateAdminUser, deleteAdminUser, AdminUser } from '../../utils/database';
import { confirmAction } from '../../utils/alert';
import { apiErrorMessage } from '../../utils/api';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });

export default function AdminUsersScreen() {
  const { user, isAdmin } = useAuth();
  const [items, setItems] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      setItems(await getAdminUsers());
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const applyPatch = async (patch: Partial<{ role: 'user' | 'admin'; isActive: boolean; tier: 'standard' | 'pro' }>) => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateAdminUser(selected.id, patch);
      setSelected(updated);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not update this account.'));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = (target: AdminUser) => {
    confirmAction('Delete account', `Permanently delete ${target.name} (${target.email})? All of their data is deleted too.`, 'Delete', async () => {
      try {
        await deleteAdminUser(target.id);
        setSelected(null);
        await load();
      } catch (err) {
        confirmAction('Could not delete account', apiErrorMessage(err, 'Please try again.'), 'OK', () => {});
      }
    });
  };

  if (!isAdmin) {
    return (
      <View style={styles.flex}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={COLORS.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Admin</Text>
          <View style={{ width: 30 }} />
        </View>
        <View style={styles.deniedBox}>
          <Ionicons name="lock-closed-outline" size={28} color={COLORS.textMuted} />
          <Text style={styles.deniedText}>Admin access required.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Users ({items.length})</Text>
        <View style={{ width: 30 }} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={!loading ? <Text style={styles.emptyText}>No accounts yet.</Text> : null}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => setSelected(item)}>
            <View style={styles.rowMain}>
              <Text style={styles.rowName}>
                {item.name} {item.id === user?.id && <Text style={styles.youTag}>(you)</Text>}
              </Text>
              <Text style={styles.rowEmail}>{item.email}</Text>
              <Text style={styles.rowMeta}>Joined {fmtDate(item.createdAt)}{item.budgetClass ? ` · ${item.budgetClass}` : ''}</Text>
            </View>
            <View style={styles.chipCol}>
              <View style={[styles.chip, item.role === 'admin' ? styles.chipAdmin : styles.chipMuted]}>
                <Text style={styles.chipText}>{item.role === 'admin' ? 'Admin' : 'User'}</Text>
              </View>
              <View style={[styles.chip, item.tier === 'pro' ? styles.chipPro : styles.chipMuted]}>
                <Text style={styles.chipText}>{item.tier === 'pro' ? 'Pro' : 'Standard'}</Text>
              </View>
              <View style={[styles.chip, item.isActive ? styles.chipActive : styles.chipInactive]}>
                <Text style={styles.chipText}>{item.isActive ? 'Active' : 'Inactive'}</Text>
              </View>
            </View>
          </Pressable>
        )}
      />

      <Modal visible={!!selected} animationType={MODAL_ANIMATION} transparent onRequestClose={() => setSelected(null)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selected?.name}</Text>
              <Pressable onPress={() => setSelected(null)}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </Pressable>
            </View>
            <Text style={styles.modalEmail}>{selected?.email}</Text>

            <View style={styles.controlRow}>
              <Text style={styles.controlLabel}>Active</Text>
              <Switch
                value={selected?.isActive ?? true}
                onValueChange={(v) => applyPatch({ isActive: v })}
                disabled={saving}
                trackColor={{ false: COLORS.cardBorder, true: COLORS.accent }}
              />
            </View>

            <Text style={styles.controlLabel}>Role</Text>
            <View style={styles.optionRow}>
              {(['user', 'admin'] as const).map((r) => (
                <Pressable
                  key={r}
                  style={[styles.optionBtn, selected?.role === r && styles.optionBtnActive]}
                  onPress={() => applyPatch({ role: r })}
                  disabled={saving}
                >
                  <Text style={[styles.optionBtnText, selected?.role === r && styles.optionBtnTextActive]}>{r === 'admin' ? 'Admin' : 'User'}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.controlLabel}>Tier</Text>
            <View style={styles.optionRow}>
              {(['standard', 'pro'] as const).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.optionBtn, selected?.tier === t && styles.optionBtnActive]}
                  onPress={() => applyPatch({ tier: t })}
                  disabled={saving}
                >
                  <Text style={[styles.optionBtnText, selected?.tier === t && styles.optionBtnTextActive]}>{t === 'pro' ? 'Pro' : 'Standard'}</Text>
                </Pressable>
              ))}
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable style={styles.deleteBtn} onPress={() => selected && onDelete(selected)} disabled={saving}>
              <Ionicons name="trash-outline" size={16} color={COLORS.red} />
              <Text style={styles.deleteBtnText}>Delete account</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.lg,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  backBtn: { width: 30 },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  deniedBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.sm },
  deniedText: { color: COLORS.textMuted, fontSize: 14 },
  listContent: { padding: SPACING.lg, gap: SPACING.sm },
  emptyText: { color: COLORS.textDim, fontSize: 13, textAlign: 'center', marginTop: SPACING.xl },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  rowMain: { flex: 1, gap: 2 },
  rowName: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  youTag: { color: COLORS.textDim, fontWeight: '400', fontSize: 12 },
  rowEmail: { color: COLORS.textMuted, fontSize: 12 },
  rowMeta: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  chipCol: { gap: 4, alignItems: 'flex-end' },
  chip: { borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 3 },
  chipText: { fontSize: 11, fontWeight: '600', color: COLORS.text },
  chipMuted: { backgroundColor: COLORS.input },
  chipAdmin: { backgroundColor: `${COLORS.purple}33` },
  chipPro: { backgroundColor: `${COLORS.accent}33` },
  chipActive: { backgroundColor: `${COLORS.accent}22` },
  chipInactive: { backgroundColor: `${COLORS.red}22` },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  modalEmail: { color: COLORS.textMuted, fontSize: 13, marginBottom: SPACING.xs },
  controlRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.xs },
  controlLabel: { color: COLORS.textMuted, fontSize: 13, marginTop: SPACING.xs },
  optionRow: { flexDirection: 'row', gap: SPACING.xs },
  optionBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.cardBorder },
  optionBtnActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  optionBtnText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  optionBtnTextActive: { color: '#04140D' },
  error: { color: COLORS.red, fontSize: 13, marginTop: SPACING.sm },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.red,
    borderRadius: RADIUS.md,
    paddingVertical: 12,
    marginTop: SPACING.md,
  },
  deleteBtnText: { color: COLORS.red, fontWeight: '700', fontSize: 14 },
});
