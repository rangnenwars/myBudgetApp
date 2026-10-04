import React, { useId, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TextInputProps,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FONTS, RADIUS, T } from '../../constants/theme';
import { LogoMark } from './LogoMark';
import { useWebAttributes } from './webAttributes';

export const TAGLINE = 'Nothing forgotten, nothing hidden.';
export const TAGLINE_HI = 'कुछ छूटे ना, कुछ छुपे ना';

// On web the fields sit inside a real <form> so password managers and
// browser autofill recognise the sign-in, and Enter submits it. The submit
// button is a <button type="submit"> (PrimaryButton `submit`), so the form's
// submit event is the single trigger on web; native uses onPress and the
// keyboard's return key instead.
const WebForm: React.FC<{ onSubmit?: () => void; children: React.ReactNode }> = ({ onSubmit, children }) =>
  Platform.OS === 'web' && onSubmit
    ? React.createElement(
        'form',
        {
          noValidate: true,
          style: { display: 'contents' },
          onSubmit: (e: { preventDefault: () => void }) => {
            e.preventDefault();
            onSubmit();
          },
        },
        children
      )
    : <>{children}</>;

// Shared shell for the signed-out screens (login, register): the green
// header band with the logo and both taglines, then a paper-coloured body
// and an optional footer pinned low.
export const AuthLayout: React.FC<{
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Wraps the fields in a <form> on web; called on submit (button or Enter). */
  onSubmit?: () => void;
}> = ({ title, subtitle, children, footer, onSubmit }) => {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.band, { paddingTop: insets.top + 40 }]}>
          <View style={styles.brandRow}>
            <LogoMark size={40} />
            <Text style={styles.brandName}>Prapanji</Text>
          </View>
          <Text style={styles.tagline}>{TAGLINE}</Text>
          <Text style={styles.taglineHi}>
            {TAGLINE_HI}
          </Text>
        </View>

        <View style={styles.body}>
          {/* The page's one <h1> on web. */}
          <Text style={styles.title} role="heading" aria-level={1}>
            {title}
          </Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          <WebForm onSubmit={onSubmit}>{children}</WebForm>
        </View>

        {footer && <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>{footer}</View>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// Label + input in the spec's style (surface fill, line border, radius 12).
// `secure` adds a show/hide toggle. `name` becomes the input's HTML name on
// web (for autofill). `literal` turns off auto-capitalise, autocorrect and
// spellcheck — always on for passwords, where a capitalised first letter
// would fail the sign-in.
export const AuthField: React.FC<TextInputProps & { label: string; hint?: string; secure?: boolean; name?: string; literal?: boolean }> = ({
  label,
  hint,
  secure,
  name,
  literal,
  style,
  onFocus,
  onBlur,
  ...input
}) => {
  const [shown, setShown] = useState(false);
  const [focused, setFocused] = useState(false);
  const labelId = useId();
  const inputRef = useWebAttributes<TextInput>({ name, id: name });
  // Inside the <form>, an untyped <button> would submit it (and be the
  // default button that Enter "clicks"), so the eye toggle is type="button".
  const eyeRef = useWebAttributes<View>({ type: 'button' });
  const plain = literal || secure;
  return (
    <View style={styles.field}>
      <Text style={styles.label} nativeID={labelId}>
        {label}
      </Text>
      <View style={styles.inputWrap}>
        <TextInput
          ref={inputRef}
          placeholderTextColor={T.inkMuted}
          secureTextEntry={secure && !shown}
          {...(plain ? { autoCapitalize: 'none' as const, autoCorrect: false, spellCheck: false } : null)}
          {...input}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, focused && styles.inputFocused, secure && styles.inputWithToggle, style]}
          aria-labelledby={labelId}
        />
        {secure && (
          <Pressable
            ref={eyeRef}
            onPress={() => setShown((v) => !v)}
            style={styles.eyeBtn}
            accessibilityRole="button"
            accessibilityLabel={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
          >
            <Ionicons name={shown ? 'eye-off-outline' : 'eye-outline'} size={20} color={T.inkMuted} />
          </Pressable>
        )}
      </View>
      {hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
};

// Indian mobile number: a fixed "+91" box beside a 10-digit field (as in the
// login prototype). Only digits are kept as the user types.
export const PhoneField: React.FC<{ value: string; onChangeText: (digits: string) => void; hint?: string; onSubmitEditing?: () => void }> = ({
  value,
  onChangeText,
  hint,
  onSubmitEditing,
}) => {
  const [focused, setFocused] = useState(false);
  const labelId = useId();
  const inputRef = useWebAttributes<TextInput>({ name: 'tel', id: 'tel' });
  return (
    <View style={styles.field}>
      <Text style={styles.label} nativeID={labelId}>
        Mobile number
      </Text>
      <View style={styles.phoneRow}>
        <View style={styles.countryBox} aria-label="Country code India, plus 91">
          <Text style={styles.countryText}>+91</Text>
        </View>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={(t) => onChangeText(t.replace(/\D/g, '').slice(0, 10))}
          placeholder="98765 43210"
          placeholderTextColor={T.inkMuted}
          keyboardType="number-pad"
          autoComplete="tel-national"
          textContentType="telephoneNumber"
          maxLength={10}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          style={[styles.input, styles.phoneInput, focused && styles.inputFocused]}
          aria-labelledby={labelId}
        />
      </View>
      {hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
};

export const isValidIndianMobile = (digits: string): boolean => /^[6-9]\d{9}$/.test(digits);

export const authStyles = StyleSheet.create({
  error: { fontFamily: FONTS.medium, color: T.negative, fontSize: 14, marginBottom: 12 },
  info: { fontFamily: FONTS.regular, color: T.inkSoft, fontSize: 15, lineHeight: 22, marginBottom: 16 },
  footerLine: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' },
  footerText: { fontFamily: FONTS.regular, color: T.inkSoft, fontSize: 15 },
  fineprint: { fontFamily: FONTS.regular, color: T.inkMuted, fontSize: 12.5, textAlign: 'center', lineHeight: 19 },
});

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  scroll: { flexGrow: 1 },
  band: { backgroundColor: T.brand, paddingHorizontal: 28, paddingBottom: 28 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 22 },
  brandName: { fontFamily: FONTS.display, color: T.onBrand, fontSize: 30, fontWeight: '700' },
  tagline: { fontFamily: FONTS.bold, color: T.onBrand, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  taglineHi: { fontFamily: FONTS.hindiMedium, color: T.onBrand, fontSize: 16, opacity: 0.92 },
  body: { paddingHorizontal: 28, paddingTop: 32 },
  title: { fontFamily: FONTS.display, color: T.ink, fontSize: 26, fontWeight: '700', marginBottom: 6 },
  subtitle: { fontFamily: FONTS.regular, color: T.inkSoft, fontSize: 15, lineHeight: 22, marginBottom: 22 },
  footer: { marginTop: 'auto', paddingTop: 32, paddingHorizontal: 28, gap: 10 },
  field: { marginBottom: 16 },
  label: { fontFamily: FONTS.medium, color: T.ink, fontSize: 14, fontWeight: '500', marginBottom: 8 },
  inputWrap: { justifyContent: 'center' },
  input: {
    fontFamily: FONTS.regular,
    backgroundColor: T.surface,
    borderColor: T.line,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    minHeight: 52,
    color: T.ink,
    fontSize: 16,
  },
  inputFocused: { borderColor: T.brand, borderWidth: 1.5 },
  inputWithToggle: { paddingRight: 48 },
  eyeBtn: { position: 'absolute', right: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  phoneRow: { flexDirection: 'row', gap: 8 },
  countryBox: {
    backgroundColor: T.surface,
    borderColor: T.line,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    minHeight: 52,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  countryText: { fontFamily: FONTS.medium, color: T.ink, fontSize: 16 },
  phoneInput: { flex: 1, letterSpacing: 0.5 },
  hint: { fontFamily: FONTS.regular, color: T.inkMuted, fontSize: 13, marginTop: 6 },
});
