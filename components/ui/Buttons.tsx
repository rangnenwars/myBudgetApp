import React from 'react';
import { Pressable, Text, StyleSheet, StyleProp, ViewStyle, ActivityIndicator, View, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORS, CONTROL, FONTS, RADIUS, T } from '../../constants/theme';
import { useWebAttributes } from './webAttributes';

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
};

// Brand fill, bold label in the on-brand colour. Height 54.
// `submit`: inside an AuthLayout <form> on web it becomes <button
// type="submit"> and leaves the press to the form's submit event, so a
// click and Enter both go through one path. Native still uses onPress.
export const PrimaryButton: React.FC<ButtonProps & { submit?: boolean }> = ({ label, onPress, disabled, loading, icon, style, submit }) => {
  const webSubmit = submit && Platform.OS === 'web';
  const ref = useWebAttributes<View>({ type: webSubmit ? 'submit' : 'button' });
  return (
  <Pressable
    ref={ref}
    accessibilityRole="button"
    accessibilityState={{ disabled: disabled || loading }}
    aria-busy={loading}
    onPress={webSubmit ? undefined : onPress}
    disabled={disabled || loading}
    style={({ pressed }) => [
      styles.base,
      styles.primary,
      pressed && styles.primaryPressed,
      (disabled || loading) && styles.disabled,
      style,
    ]}
  >
    {loading ? (
      <ActivityIndicator color={T.onBrand} />
    ) : (
      <View style={styles.row}>
        {icon && <Ionicons name={icon} size={20} color={T.onBrand} />}
        <Text style={styles.primaryText}>{label}</Text>
      </View>
    )}
  </Pressable>
  );
};

// Surface with a line border. Height 52.
export const SecondaryButton: React.FC<ButtonProps> = ({ label, onPress, disabled, loading, icon, style }) => {
  const ref = useWebAttributes<View>({ type: 'button' });
  return (
  <Pressable
    ref={ref}
    accessibilityRole="button"
    accessibilityState={{ disabled: disabled || loading }}
    onPress={onPress}
    disabled={disabled || loading}
    style={({ pressed }) => [
      styles.base,
      styles.secondary,
      pressed && styles.secondaryPressed,
      (disabled || loading) && styles.disabled,
      style,
    ]}
  >
    {loading ? (
      <ActivityIndicator color={T.ink} />
    ) : (
      <View style={styles.row}>
        {icon && <Ionicons name={icon} size={18} color={T.ink} />}
        <Text style={styles.secondaryText}>{label}</Text>
      </View>
    )}
  </Pressable>
  );
};

// Brand-coloured text link with a 44px touch target.
export const TextLink: React.FC<{ label: string; onPress: () => void; style?: StyleProp<ViewStyle>; underline?: boolean }> = ({
  label,
  onPress,
  style,
  underline,
}) => (
  <Pressable accessibilityRole="link" onPress={onPress} hitSlop={10} style={style}>
    {({ pressed }) => (
      <Text style={[styles.link, underline && styles.underline, pressed && { color: COLORS.accentDim }]}>{label}</Text>
    )}
  </Pressable>
);

const styles = StyleSheet.create({
  base: {
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  primary: { backgroundColor: T.brand, minHeight: CONTROL.primaryHeight },
  primaryPressed: { backgroundColor: T.brandDeep },
  primaryText: { fontFamily: FONTS.bold, color: T.onBrand, fontSize: 17, fontWeight: '700' },
  secondary: {
    backgroundColor: T.surface,
    borderColor: T.line,
    borderWidth: 1,
    minHeight: CONTROL.secondaryHeight,
  },
  secondaryPressed: { backgroundColor: T.bg },
  secondaryText: { fontFamily: FONTS.medium, color: T.ink, fontSize: 16, fontWeight: '500' },
  disabled: { opacity: 0.5 },
  link: { fontFamily: FONTS.bold, color: T.brand, fontSize: 15, fontWeight: '700' },
  underline: { textDecorationLine: 'underline' },
});
