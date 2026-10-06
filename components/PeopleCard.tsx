import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { Card } from './Card';
import { COLORS, SPACING } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { getPeople, PeopleSummary } from '../utils/database';
import { fmtAmount } from '../utils/people';

/** Home summary of money friends owe the user and the user owes friends. Opens the People page. */
export const PeopleCard: React.FC<{ refreshKey?: number }> = ({ refreshKey = 0 }) => {
  const { user } = useAuth();
  const [data, setData] = useState<PeopleSummary | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      getPeople()
        .then((r) => active && setData(r))
        .catch(() => active && setData(null));
      return () => {
        active = false;
      };
    }, [user?.id, refreshKey])
  );

  if (!data) return null;
  const overdue = data.people.filter((p) => p.overdue).length;

  return (
    <Pressable onPress={() => router.push('/people')} accessibilityRole="button" accessibilityLabel="People, open">
      <Card>
        <View style={styles.row}>
          <View>
            <Text style={styles.label}>You get</Text>
            <Text style={[styles.value, { color: COLORS.positive }]}>{fmtAmount(data.youGet)}</Text>
          </View>
          <View style={styles.right}>
            <Text style={styles.label}>You owe</Text>
            <Text style={[styles.value, { color: COLORS.red }]}>{fmtAmount(data.youOwe)}</Text>
          </View>
        </View>
        <View style={styles.footer}>
          <Text style={styles.hint}>
            {data.people.length === 0 ? 'Track money you lend, borrow or share with friends' : overdue > 0 ? `${overdue} overdue` : 'Open People'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </View>
      </Card>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  right: { alignItems: 'flex-end' },
  label: { color: COLORS.textDim, fontSize: 12 },
  value: { fontSize: 22, fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.sm },
  hint: { color: COLORS.textMuted, fontSize: 12 },
});
