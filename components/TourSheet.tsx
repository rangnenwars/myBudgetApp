import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Modal, Pressable } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from './i18n';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../constants/theme';
import { useLanguage } from '../context/LanguageContext';
import { useTour } from '../context/TourContext';
import { LANGUAGES, t } from '../utils/i18n';
import { TOUR_LENGTH, TOUR_STEPS, stepButtons } from '../utils/tour';

/**
 * The first-time tour: one card at a time, Skip on every card but the last, Back and Next between,
 * and a language choice on the first card. It opens by itself once after sign-up and can be replayed
 * from Settings. Plain components on purpose: it must look the same on every phone and on the web.
 */
export const TourSheet: React.FC = () => {
  const { visible, end } = useTour();
  const { lang, setLang } = useLanguage();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (visible) setIndex(0);
  }, [visible]);

  if (!visible) return null;
  const step = TOUR_STEPS[index];
  const buttons = stepButtons(index);
  const number = index + 1;

  const addFirst = () => {
    end('finished', TOUR_LENGTH);
    router.push({ pathname: '/(tabs)', params: { quick: '1' } });
  };

  return (
    // Back on Android counts as skipping; tapping outside does nothing, so it is never closed by accident.
    <Modal visible transparent animationType={MODAL_ANIMATION} onRequestClose={() => end('skipped', number)}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal accessibilityLabel="How to use Prapanji">
          <View style={styles.top}>
            <Text style={styles.count}>{t('{n} of {total}', { n: number, total: TOUR_LENGTH })}</Text>
            {buttons.skip ? (
              <Pressable onPress={() => end('skipped', number)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Skip tour">
                <Text style={styles.skip}>Skip tour</Text>
              </Pressable>
            ) : (
              <View />
            )}
          </View>

          <View style={styles.iconWrap}>
            <Ionicons name={step.icon} size={30} color={COLORS.accent} />
          </View>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.body}>{step.body}</Text>

          {index === 0 && (
            <View style={styles.langBlock}>
              <Text style={styles.langLabel}>Language</Text>
              <View style={styles.langToggle} accessibilityRole="radiogroup">
                {LANGUAGES.map((l) => (
                  <Pressable key={l.key} style={[styles.langOption, lang === l.key && styles.langOptionActive]} onPress={() => setLang(l.key)} accessibilityRole="radio" accessibilityState={{ selected: lang === l.key }}>
                    <Text style={[styles.langText, lang === l.key && styles.langTextActive]}>{l.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          <View style={styles.actions}>
            {index === 0 && (
              <Pressable style={[styles.btn, styles.btnPrimary, styles.full]} onPress={() => setIndex(1)} accessibilityRole="button">
                <Text style={[styles.btnText, styles.btnPrimaryText]}>Start the tour</Text>
              </Pressable>
            )}
            {index > 0 && buttons.next && (
              <>
                <Pressable style={[styles.btn, styles.half]} onPress={() => setIndex(index - 1)} accessibilityRole="button">
                  <Text style={styles.btnText}>Back</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.btnPrimary, styles.half]} onPress={() => setIndex(index + 1)} accessibilityRole="button">
                  <Text style={[styles.btnText, styles.btnPrimaryText]}>Next</Text>
                </Pressable>
              </>
            )}
            {!buttons.next && (
              <View style={styles.stack}>
                <Pressable style={[styles.btn, styles.btnPrimary]} onPress={addFirst} accessibilityRole="button">
                  <Text style={[styles.btnText, styles.btnPrimaryText]}>Add my first spend</Text>
                </Pressable>
                <Pressable style={styles.btn} onPress={() => end('finished', TOUR_LENGTH)} accessibilityRole="button">
                  <Text style={styles.btnText}>Done</Text>
                </Pressable>
              </View>
            )}
          </View>

          <View style={styles.dots} accessibilityElementsHidden>
            {TOUR_STEPS.map((s, i) => (
              <View key={s.key} style={[styles.dot, i === index && styles.dotActive]} />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 420, alignSelf: 'center', backgroundColor: COLORS.bg, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 24 },
  count: { color: COLORS.textMuted, fontSize: 12 },
  skip: { color: COLORS.accent, fontSize: 14, fontWeight: '600' },
  iconWrap: { width: 56, height: 56, borderRadius: RADIUS.full, backgroundColor: COLORS.accent + '1A', alignItems: 'center', justifyContent: 'center', marginTop: SPACING.xs },
  title: { color: COLORS.text, fontSize: 19, fontWeight: '700', marginTop: SPACING.xs },
  body: { color: COLORS.textMuted, fontSize: 14.5, lineHeight: 21 },
  langBlock: { gap: 6, marginTop: SPACING.xs },
  langLabel: { color: COLORS.textMuted, fontSize: 12 },
  langToggle: { flexDirection: 'row', alignSelf: 'flex-start', borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.full, overflow: 'hidden' },
  langOption: { paddingHorizontal: SPACING.md, paddingVertical: 6 },
  langOptionActive: { backgroundColor: COLORS.accent },
  langText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  langTextActive: { color: COLORS.onAccent },
  actions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  stack: { flex: 1, gap: SPACING.xs },
  btn: { alignItems: 'center', borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.md, paddingVertical: 12 },
  btnPrimary: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  btnText: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  btnPrimaryText: { color: COLORS.onAccent },
  full: { flex: 1 },
  half: { flex: 1 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginTop: SPACING.xs },
  dot: { width: 6, height: 4, borderRadius: 2, backgroundColor: COLORS.cardBorder },
  dotActive: { width: 14, backgroundColor: COLORS.accent },
});
