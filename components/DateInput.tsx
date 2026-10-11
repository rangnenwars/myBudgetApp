import React, { useState } from 'react';
import { View, StyleSheet, Pressable, TextInput, StyleProp, TextStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { CalendarSheet } from './CalendarSheet';

interface Props {
  /** 'YYYY-MM-DD', or '' for no date; may be half-typed. */
  value: string;
  onChange: (value: string) => void;
  /** Earliest / latest day the calendar lets you pick (typing is checked by the caller). */
  min?: string;
  max?: string;
  /** The screen's own text-input style, so the box matches its neighbours. */
  inputStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}

/** A typed `YYYY-MM-DD` box with a calendar button beside it that opens the bottom-sheet calendar. */
export const DateInput: React.FC<Props> = ({ value, onChange, min, max, inputStyle, accessibilityLabel }) => {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.row}>
      <TextInput
        style={[inputStyle, styles.input]}
        value={value}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={COLORS.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={10}
        accessibilityLabel={accessibilityLabel}
      />
      <Pressable style={styles.btn} onPress={() => setOpen(true)} hitSlop={6} accessibilityLabel="Open calendar">
        <Ionicons name="calendar-outline" size={18} color={COLORS.accent} />
      </Pressable>
      <CalendarSheet visible={open} value={value} min={min} max={max} onSelect={onChange} onClose={() => setOpen(false)} />
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  input: { flex: 1, minWidth: 0 },
  btn: { backgroundColor: COLORS.input, borderColor: COLORS.accent, borderWidth: 1, borderRadius: RADIUS.md, padding: 10 },
});
