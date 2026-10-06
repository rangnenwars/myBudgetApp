import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Card } from '../../components/Card';
import { IouSheet } from '../../components/IouSheet';
import { Button, ScreenHeader, kit } from '../../components/ScreenKit';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { getPeople, PeopleSummary } from '../../utils/database';
import { balanceLabel, filterPeople, fmtAmount, PeopleFilter, shortDate } from '../../utils/people';

const FILTERS: { key: PeopleFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'get', label: 'You get' },
  { key: 'owe', label: 'You owe' },
  { key: 'overdue', label: 'Overdue' },
];

const EMPTY_TEXT: Record<PeopleFilter, string> = {
  all: 'No one yet. Add a friend you lent money to, or someone you borrowed from.',
  get: 'Nobody owes you right now.',
  owe: 'You don\'t owe anyone right now.',
  overdue: 'Nothing is overdue.',
};

export default function PeopleScreen() {
  const { user } = useAuth();
  const [data, setData] = useState<PeopleSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<PeopleFilter>('all');
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getPeople());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (user) load();
    }, [user?.id, load])
  );

  const shown = data ? filterPeople(data.people, filter) : [];

  return (
    <View style={kit.screen}>
      <ScreenHeader title="People" />
      <ScrollView contentContainerStyle={kit.content}>
        {!data ? (
          failed ? (
            <Text style={kit.empty}>Could not load your people. Go back and try again.</Text>
          ) : (
            <ActivityIndicator color={COLORS.accent} />
          )
        ) : (
          <>
            <Card>
              <View style={styles.totals}>
                <View>
                  <Text style={kit.dim}>You get</Text>
                  <Text style={[styles.total, { color: COLORS.positive }]}>{fmtAmount(data.youGet)}</Text>
                </View>
                <View style={styles.right}>
                  <Text style={kit.dim}>You owe</Text>
                  <Text style={[styles.total, { color: COLORS.red }]}>{fmtAmount(data.youOwe)}</Text>
                </View>
              </View>
            </Card>

            <View style={styles.filters}>
              {FILTERS.map((f) => (
                <Pressable key={f.key} style={[styles.chip, filter === f.key && styles.chipActive]} onPress={() => setFilter(f.key)} accessibilityRole="button">
                  <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
                </Pressable>
              ))}
            </View>

            {shown.length === 0 ? (
              <Text style={kit.empty}>{EMPTY_TEXT[filter]}</Text>
            ) : (
              <Card style={styles.list}>
                {shown.map((p, i) => {
                  const label = balanceLabel(p.balance);
                  const sub = p.dueDate && p.balance !== 0 ? `Pay back by ${shortDate(p.dueDate)}` : p.lastActivity ? `Last activity ${shortDate(p.lastActivity)}` : 'No activity yet';
                  return (
                    <Pressable
                      key={p.id}
                      style={[styles.row, i !== 0 && styles.rowBorder]}
                      onPress={() => router.push({ pathname: '/people/[id]', params: { id: String(p.id) } })}
                      accessibilityRole="button"
                      accessibilityLabel={`${p.name}, ${label.text}`}
                    >
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{p.name.slice(0, 1).toUpperCase()}</Text>
                      </View>
                      <View style={styles.rowMain}>
                        <Text style={styles.name} numberOfLines={1}>
                          {p.name}
                        </Text>
                        <Text style={kit.dim}>{sub}</Text>
                      </View>
                      <View style={styles.right}>
                        <Text style={[styles.amount, { color: label.color }]}>{label.text}</Text>
                        {p.overdue && (
                          <View style={styles.overdue}>
                            <Text style={styles.overdueText}>Overdue</Text>
                          </View>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </Card>
            )}

            <Button label="Add person or IOU" onPress={() => setSheetOpen(true)} />
          </>
        )}
      </ScrollView>

      <IouSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        people={data?.people ?? []}
        onSaved={(id) => {
          load();
          router.push({ pathname: '/people/[id]', params: { id: String(id) } });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  totals: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  total: { fontSize: 26, fontWeight: '700' },
  right: { alignItems: 'flex-end', gap: 4 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: { borderColor: COLORS.cardBorder, borderWidth: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 7 },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { color: COLORS.text, fontSize: 13 },
  chipTextActive: { color: COLORS.onAccent, fontWeight: '600' },
  list: { padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  rowMain: { flex: 1, gap: 2 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.cardBorder, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: COLORS.accentDim, fontWeight: '700' },
  name: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  amount: { fontSize: 14, fontWeight: '700' },
  overdue: { backgroundColor: '#FAEEDA', borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 2 },
  overdueText: { color: '#633806', fontSize: 11, fontWeight: '600' },
});
