import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { useAuth } from '../context/AuthContext';

interface Props {
  title: string;
  description: string;
  children: React.ReactNode;
}

export const ProGate: React.FC<Props> = ({ title, description, children }) => {
  const { isPro, setTier } = useAuth();
  if (isPro) return <>{children}</>;

  return (
    <View style={styles.wrap}>
      <Ionicons name="lock-closed" size={28} color={COLORS.proGold} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.desc}>{description}</Text>
      <Pressable style={styles.cta} onPress={() => setTier('pro')}>
        <Text style={styles.ctaText}>Try Pro (test mode)</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: COLORS.proGold,
    borderStyle: 'dashed',
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
  },
  title: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: SPACING.sm,
  },
  desc: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: SPACING.md,
  },
  cta: {
    backgroundColor: `${COLORS.proGold}22`,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  ctaText: {
    color: COLORS.proGold,
    fontWeight: '600',
    fontSize: 13,
  },
});
