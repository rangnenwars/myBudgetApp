import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Modal, Switch, KeyboardAvoidingView, Platform, TextInput, ScrollView } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import {
  getAdminUsers,
  updateAdminUser,
  deleteAdminUser,
  getUserFeatureAccess,
  setUserFeature,
  AdminUser,
  AdminRole,
  UserFeatureAccess,
} from '../../utils/database';
import { FeatureKey } from '../../constants/features';
import { confirmAction } from '../../utils/alert';
import { apiErrorMessage } from '../../utils/api';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });

// Order matters here — rendered left-to-right/top-to-bottom in the role
// picker, low to high privilege, so promote/demote reads as moving along the row.
const ROLES: AdminRole[] = ['user', 'support', 'system_manager', 'admin'];
const ROLE_LABEL: Record<AdminRole, string> = { user: 'User', support: 'Support', system_manager: 'System mgr', admin: 'Admin' };

// Account list for staff. Admins can change role, tier and active state and
// delete accounts; support can only activate/deactivate regular users (the
// server enforces the same split — routes/admin.ts). System managers don't
// see accounts at all, only aggregate metrics.
export default function AdminUsersScreen() {
  const { user, isAdmin, isStaff, canViewMetrics } = useAuth();
  // Admin and system manager may switch a user's optional features; support only sees them.
  const canManageFeatures = canViewMetrics;
  const [items, setItems] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<UserFeatureAccess[] | null>(null);
  const isSelf = !!selected && selected.id === user?.id;
  // Support may only act on regular users, never other staff.
  const canToggleActive = !!selected && !isSelf && (isAdmin || selected.role === 'user');

  const load = useCallback(async () => {
    if (!isStaff) return;
    setLoading(true);
    try {
      const page = await getAdminUsers(search.trim());
      setItems(page.items);
      setTotal(page.total);
    } finally {
      setLoading(false);
    }
  }, [isStaff, search]);

  // Search runs on the server; wait for a pause in typing.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    const timer = setTimeout(() => loadRef.current().catch(() => {}), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useFocusEffect(useCallback(() => { loadRef.current().catch(() => {}); }, []));

  const applyPatch = async (patch: Partial<{ role: AdminRole; isActive: boolean; tier: 'standard' | 'pro' }>) => {
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

  // Optional features of whoever's sheet is open (read fresh each time it opens).
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    setAccess(null);
    if (selectedId == null) return;
    let active = true;
    getUserFeatureAccess(selectedId)
      .then((rows) => active && setAccess(rows))
      .catch(() => active && setAccess([]));
    return () => {
      active = false;
    };
  }, [selectedId]);

  const onFeature = async (key: FeatureKey, on: boolean) => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const row = await setUserFeature(selected.id, key, on);
      setAccess((prev) => (prev ? prev.map((f) => (f.key === key ? row : f)) : prev));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not change this feature.'));
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

  if (!isStaff) {
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
          <Text style={styles.deniedText}>Staff access required.</Text>
          {canViewMetrics && (
            <Pressable style={styles.linkBtn} onPress={() => router.replace('/admin/metrics')}>
              <Text style={styles.linkBtnText}>Open system metrics</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  const visible = items;

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Users ({total})</Text>
        <View style={styles.headerLinks}>
          {canViewMetrics && (
            <Pressable onPress={() => router.push('/admin/metrics')} hitSlop={6} accessibilityLabel="System metrics">
              <Ionicons name="stats-chart-outline" size={20} color={COLORS.textMuted} />
            </Pressable>
          )}
          <Pressable onPress={() => router.push('/admin/features')} hitSlop={6} accessibilityLabel="Feature access">
            <Ionicons name="toggle-outline" size={22} color={COLORS.textMuted} />
          </Pressable>
          {isAdmin && (
            <Pressable onPress={() => router.push('/admin/audit-log')} hitSlop={6} accessibilityLabel="Audit log">
              <Ionicons name="document-text-outline" size={20} color={COLORS.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={COLORS.textDim} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or email"
          placeholderTextColor={COLORS.textDim}
          autoCapitalize="none"
        />
      </View>
      {!isAdmin && <Text style={styles.supportNote}>Support access: you can activate or deactivate regular user accounts.</Text>}

      <FlatList
        data={visible}
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
              <Text style={styles.rowEmail}>
                {item.email}
                {item.emailVerified ? '' : ' · unconfirmed'}
              </Text>
              <Text style={styles.rowMeta}>Joined {fmtDate(item.createdAt)}{item.budgetClass ? ` · ${item.budgetClass}` : ''}</Text>
            </View>
            <View style={styles.chipCol}>
              <View style={[styles.chip, ROLE_CHIP_STYLE[item.role]]}>
                <Text style={styles.chipText}>{ROLE_LABEL[item.role]}</Text>
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
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalSheet} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selected?.name}</Text>
              <Pressable onPress={() => setSelected(null)}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </Pressable>
            </View>
            <Text style={styles.modalEmail}>{selected?.email}</Text>

            {isSelf && <Text style={styles.selfNote}>This is your own account — use your own login to change these settings.</Text>}

            <View style={styles.controlRow}>
              <Text style={styles.controlLabel}>Active</Text>
              <Switch
                value={selected?.isActive ?? true}
                onValueChange={(v) => applyPatch({ isActive: v })}
                disabled={saving || !canToggleActive}
                trackColor={{ false: COLORS.cardBorder, true: COLORS.accent }}
              />
            </View>
            {!isAdmin && !isSelf && selected?.role !== 'user' && <Text style={styles.selfNote}>Only an admin can change staff accounts.</Text>}

            {isAdmin && (
            <>
            <Text style={styles.controlLabel}>Role</Text>
            <View style={styles.roleOptionRow}>
              {ROLES.map((r) => (
                <Pressable
                  key={r}
                  style={[styles.roleOptionBtn, selected?.role === r && styles.optionBtnActive]}
                  onPress={() => applyPatch({ role: r })}
                  disabled={saving || isSelf}
                >
                  <Text style={[styles.optionBtnText, selected?.role === r && styles.optionBtnTextActive]}>{ROLE_LABEL[r]}</Text>
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
                  disabled={saving || isSelf}
                >
                  <Text style={[styles.optionBtnText, selected?.tier === t && styles.optionBtnTextActive]}>{t === 'pro' ? 'Pro' : 'Standard'}</Text>
                </Pressable>
              ))}
            </View>

            </>
            )}

            <Text style={styles.controlLabel}>Feature access</Text>
            <Text style={styles.selfNote}>Home, Transactions, Reports, Budgets, Accounts, Input expenses and People are always on.</Text>
            {!access ? (
              <Text style={styles.selfNote}>Loading…</Text>
            ) : (
              access.map((f) => (
                <View key={f.key} style={styles.controlRow}>
                  <View style={styles.featureMain}>
                    <Text style={styles.featureName}>{f.label}</Text>
                    <Text style={styles.selfNote}>
                      {f.on
                        ? `On · ${f.source === 'admin' ? `by ${f.changedByEmail ?? 'staff'}` : f.source === 'existing_data' ? 'had data before this change' : 'at sign-up'}`
                        : f.requestedAt
                          ? `Off · asked for it ${fmtDate(f.requestedAt)}`
                          : 'Off'}
                    </Text>
                  </View>
                  <Switch
                    value={f.on}
                    onValueChange={(v) => onFeature(f.key, v)}
                    disabled={saving || !canManageFeatures}
                    trackColor={{ false: COLORS.cardBorder, true: COLORS.accent }}
                    accessibilityLabel={`${f.label} for this user`}
                  />
                </View>
              ))
            )}
            {!canManageFeatures && <Text style={styles.selfNote}>Only an admin or system manager can change feature access.</Text>}
            <Text style={styles.selfNote}>Switching a feature off hides it; the user's data is kept.</Text>

            {error && <Text style={styles.error}>{error}</Text>}

            {isAdmin && (
              <Pressable style={[styles.deleteBtn, isSelf && styles.deleteBtnDisabled]} onPress={() => selected && onDelete(selected)} disabled={saving || isSelf}>
                <Ionicons name="trash-outline" size={16} color={isSelf ? COLORS.textDim : COLORS.red} />
                <Text style={[styles.deleteBtnText, isSelf && styles.deleteBtnTextDisabled]}>Delete account</Text>
              </Pressable>
            )}
          </ScrollView>
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
  linkBtn: { marginTop: SPACING.sm, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 10 },
  linkBtnText: { color: COLORS.text, fontWeight: '600' },
  headerLinks: { flexDirection: 'row', gap: SPACING.md, minWidth: 30, justifyContent: 'flex-end' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    backgroundColor: COLORS.input,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
  },
  searchInput: { flex: 1, color: COLORS.text, fontSize: 14, paddingVertical: 9 },
  supportNote: { color: COLORS.textDim, fontSize: 12, marginHorizontal: SPACING.lg, marginTop: SPACING.sm },
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
  chipSupport: { backgroundColor: `${COLORS.blue}33` },
  chipSystemManager: { backgroundColor: `${COLORS.yellow}33` },
  chipPro: { backgroundColor: `${COLORS.accent}33` },
  chipActive: { backgroundColor: `${COLORS.accent}22` },
  chipInactive: { backgroundColor: `${COLORS.red}22` },
  modalBackdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'flex-end' },
  modalScroll: { backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, maxHeight: '90%', flexGrow: 0 },
  modalSheet: { padding: SPACING.lg, gap: SPACING.sm },
  featureMain: { flex: 1, gap: 1 },
  featureName: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  modalEmail: { color: COLORS.textMuted, fontSize: 13, marginBottom: SPACING.xs },
  selfNote: { color: COLORS.textDim, fontSize: 12, marginBottom: SPACING.xs },
  controlRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.xs },
  controlLabel: { color: COLORS.textMuted, fontSize: 13, marginTop: SPACING.xs },
  optionRow: { flexDirection: 'row', gap: SPACING.xs },
  optionBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.cardBorder },
  roleOptionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  roleOptionBtn: { width: '48%', alignItems: 'center', paddingVertical: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.cardBorder },
  optionBtnActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  optionBtnText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  optionBtnTextActive: { color: COLORS.onAccent },
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
  deleteBtnDisabled: { borderColor: COLORS.cardBorder },
  deleteBtnTextDisabled: { color: COLORS.textDim },
});

const ROLE_CHIP_STYLE: Record<AdminRole, object> = {
  user: styles.chipMuted,
  support: styles.chipSupport,
  system_manager: styles.chipSystemManager,
  admin: styles.chipAdmin,
};
