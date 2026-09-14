import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, SectionList, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../constants/theme';
import { useCategories } from '../context/CategoriesContext';
import { confirmAction, showAlert } from '../utils/alert';
import { apiErrorMessage } from '../utils/api';

interface Props {
  type: 'income' | 'expense';
  value: string | null;
  onChange: (categoryKey: string) => void;
}

export const CategoryPicker: React.FC<Props> = ({ type, value, onChange }) => {
  const { categories, getCategory, groupCategories, addCategory, renameCategory, deleteCategory } = useCategories();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const selected = value ? getCategory(value) : undefined;

  const query = search.trim().toLowerCase();
  const sections = groupCategories(type)
    .map((g) => ({ title: g.group, data: query ? g.items.filter((i) => i.label.toLowerCase().includes(query)) : g.items }))
    .filter((s) => s.data.length > 0);

  const closeModal = () => {
    setOpen(false);
    setAdding(false);
    setNewName('');
    setSearch('');
    setEditingKey(null);
    setEditName('');
  };

  const closeAddForm = () => {
    setAdding(false);
    setNewName('');
    setAddError(null);
  };

  const onSaveNew = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const isDuplicate = categories.some(
      (c) => c.type === type && c.label.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (isDuplicate) {
      setAddError(`"${trimmed}" already exists.`);
      return;
    }
    setAddError(null);
    setSaving(true);
    try {
      const created = await addCategory({ name: trimmed, type });
      closeAddForm();
      onChange(created.key);
      closeModal();
    } catch (err) {
      showAlert('Could not add category', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (key: string, label: string) => {
    setEditingKey(key);
    setEditName(label);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditName('');
  };

  const onSaveEdit = async () => {
    if (!editingKey || !editName.trim()) return;
    setRenaming(true);
    try {
      await renameCategory(editingKey, editName.trim());
      cancelEdit();
    } catch (err) {
      showAlert('Could not rename category', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setRenaming(false);
    }
  };

  const onDelete = (key: string, label: string) => {
    confirmAction('Delete category', `Remove "${label}"? This can't be undone.`, 'Delete', async () => {
      setDeletingKey(key);
      try {
        await deleteCategory(key);
      } catch (err) {
        showAlert('Could not delete category', apiErrorMessage(err, 'Please try again.'));
      } finally {
        setDeletingKey(null);
      }
    });
  };

  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setOpen(true)}>
        {selected ? (
          <View style={styles.selectedRow}>
            <Text style={styles.icon}>{selected.icon}</Text>
            <Text style={styles.selectedText} numberOfLines={1}>{selected.label}</Text>
          </View>
        ) : (
          <Text style={styles.placeholder}>Select category</Text>
        )}
        <Ionicons name="chevron-down" size={18} color={COLORS.textMuted} />
      </Pressable>

      <Modal visible={open} animationType={MODAL_ANIMATION} transparent onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose category</Text>
              <Pressable onPress={closeModal}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </Pressable>
            </View>

            <View style={styles.searchWrap}>
              <Ionicons name="search" size={16} color={COLORS.textDim} />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Search categories"
                placeholderTextColor={COLORS.textDim}
              />
              {search.length > 0 && (
                <Pressable hitSlop={8} onPress={() => setSearch('')}>
                  <Ionicons name="close-circle" size={16} color={COLORS.textDim} />
                </Pressable>
              )}
            </View>

            {adding ? (
              <View style={styles.addForm}>
                <Text style={styles.addLabel}>New category name</Text>
                <TextInput
                  style={styles.addInput}
                  value={newName}
                  onChangeText={(text) => {
                    setNewName(text);
                    if (addError) setAddError(null);
                  }}
                  placeholder="e.g. Pet supplies"
                  placeholderTextColor={COLORS.textDim}
                  autoFocus
                />
                {addError && <Text style={styles.addError}>{addError}</Text>}
                <View style={styles.addFormButtons}>
                  <Pressable style={styles.addCancelBtn} onPress={closeAddForm} disabled={saving}>
                    <Text style={styles.addCancelBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.addSaveBtn} onPress={onSaveNew} disabled={saving || !newName.trim()}>
                    <Text style={styles.addSaveBtnText}>{saving ? 'Saving…' : 'Add'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable style={styles.addRow} onPress={() => setAdding(true)}>
                <Ionicons name="add-circle-outline" size={18} color={COLORS.accent} />
                <Text style={styles.addRowText}>Add custom category</Text>
              </Pressable>
            )}

            <SectionList
              sections={sections}
              keyExtractor={(item) => item.key}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={query ? <Text style={styles.emptyText}>No categories match "{search.trim()}"</Text> : null}
              renderSectionHeader={({ section }) => (
                <Text style={styles.sectionHeader}>{section.title}</Text>
              )}
              renderItem={({ item }) => {
                if (editingKey === item.key) {
                  return (
                    <View style={styles.editRow}>
                      <TextInput
                        style={styles.editInput}
                        value={editName}
                        onChangeText={setEditName}
                        autoFocus
                        placeholderTextColor={COLORS.textDim}
                      />
                      <Pressable hitSlop={8} style={styles.actionBtn} onPress={cancelEdit} disabled={renaming}>
                        <Ionicons name="close" size={18} color={COLORS.textMuted} />
                      </Pressable>
                      <Pressable hitSlop={8} style={styles.actionBtn} onPress={onSaveEdit} disabled={renaming || !editName.trim()}>
                        {renaming ? (
                          <ActivityIndicator size="small" color={COLORS.accent} />
                        ) : (
                          <Ionicons name="checkmark" size={18} color={COLORS.accent} />
                        )}
                      </Pressable>
                    </View>
                  );
                }

                return (
                  <Pressable
                    style={styles.item}
                    onPress={() => {
                      onChange(item.key);
                      closeModal();
                    }}
                  >
                    <Text style={styles.icon}>{item.icon}</Text>
                    <Text style={styles.itemLabel} numberOfLines={1}>{item.label}</Text>
                    {value === item.key && <Ionicons name="checkmark" size={18} color={COLORS.accent} />}
                    {item.isCustom && (
                      <>
                        <Pressable
                          hitSlop={8}
                          style={styles.actionBtn}
                          onPress={(e) => {
                            e.stopPropagation();
                            startEdit(item.key, item.label);
                          }}
                        >
                          <Ionicons name="pencil-outline" size={15} color={COLORS.textMuted} />
                        </Pressable>
                        {deletingKey === item.key ? (
                          <ActivityIndicator size="small" color={COLORS.textMuted} style={styles.actionBtn} />
                        ) : (
                          <Pressable
                            hitSlop={8}
                            style={styles.actionBtn}
                            onPress={(e) => {
                              e.stopPropagation();
                              onDelete(item.key, item.label);
                            }}
                          >
                            <Ionicons name="trash-outline" size={16} color={COLORS.red} />
                          </Pressable>
                        )}
                      </>
                    )}
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.input,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
  },
  selectedRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  icon: { fontSize: 16, marginRight: SPACING.sm },
  selectedText: { color: COLORS.text, fontSize: 14, flexShrink: 1 },
  placeholder: { color: COLORS.textDim, fontSize: 14 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    maxHeight: '80%',
    paddingBottom: SPACING.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  modalTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    backgroundColor: COLORS.input,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
  },
  searchInput: { flex: 1, color: COLORS.text, fontSize: 14, paddingVertical: 9 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    marginTop: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  addRowText: { color: COLORS.accent, fontSize: 14, fontWeight: '600' },
  addForm: {
    padding: SPACING.md,
    marginTop: SPACING.xs,
    gap: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  addLabel: { color: COLORS.textMuted, fontSize: 12 },
  addError: { color: COLORS.red, fontSize: 12 },
  addInput: {
    backgroundColor: COLORS.input,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    color: COLORS.text,
    fontSize: 14,
  },
  addFormButtons: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
  addCancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.cardBorder },
  addCancelBtnText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  addSaveBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: RADIUS.md, backgroundColor: COLORS.accent },
  addSaveBtnText: { color: '#04140D', fontSize: 13, fontWeight: '700' },
  sectionHeader: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xs,
    backgroundColor: COLORS.bg,
  },
  emptyText: { color: COLORS.textDim, fontSize: 13, textAlign: 'center', padding: SPACING.lg },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
  },
  itemLabel: { color: COLORS.text, fontSize: 14, flex: 1 },
  actionBtn: { marginLeft: SPACING.sm, padding: 2 },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
  },
  editInput: {
    flex: 1,
    backgroundColor: COLORS.input,
    borderColor: COLORS.accent,
    borderWidth: 1,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 8,
    color: COLORS.text,
    fontSize: 14,
  },
});
