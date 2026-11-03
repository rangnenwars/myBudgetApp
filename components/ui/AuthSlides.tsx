import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { FONTS, T } from '../../constants/theme';
import { AuthSlideArt } from './AuthSlideArt';

type Slide = { title: string; body: string; note?: string };

const SLIDES: Slide[] = [
  {
    title: 'Built for everyone',
    body: 'Pocket money, salary, rent, EMIs. Know where every rupee goes.',
  },
  {
    title: 'Parents, start the conversation',
    body: 'Teach money before they earn it. Sit down together and build their first budget.',
  },
  {
    title: 'Better choices, every day',
    body: 'See where money goes, pause before you spend, and choose with facts instead of impulse.',
  },
  {
    title: 'Same pocket money, two paths',
    body: 'Asha tracks and saves first. Ravi spends as it comes. Who buys the phone without a loan?',
    note: 'Illustrative example. Studies link financial know-how to better saving and borrowing decisions.',
  },
  {
    title: 'Start young, compound for life',
    body: 'Money habits built early keep paying off for decades.',
  },
];

const ADVANCE_MS = 6000;

const prefersReducedMotion = (): boolean =>
  Platform.OS === 'web' && typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Marketing carousel for the signed-out screens. `compact` is the short strip
// above the form on narrow screens (title + one line); the full version, used
// beside the form on wide screens, adds the note and an illustration per slide.
export const AuthSlides: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const [index, setIndex] = useState(0);
  // Bumped on a manual tap so the 6 s timer restarts instead of skipping ahead.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), ADVANCE_MS);
    return () => clearInterval(id);
  }, [tick]);

  const slide = SLIDES[index];
  const go = (i: number) => {
    setIndex(i);
    setTick((t) => t + 1);
  };

  return (
    <View style={compact ? styles.compactWrap : styles.wrap}>
      <Text style={styles.counter}>
        {index + 1} of {SLIDES.length}
      </Text>
      <View style={compact ? styles.compactBody : styles.body} aria-live="off">
        <Text style={compact ? styles.compactTitle : styles.title}>{slide.title}</Text>
        <Text style={compact ? styles.compactText : styles.text}>{slide.body}</Text>
        {!compact && slide.note && <Text style={styles.note}>{slide.note}</Text>}
      </View>
      {!compact && (
        <View style={styles.art}>
          <AuthSlideArt index={index} />
        </View>
      )}
      <View style={styles.dots}>
        {SLIDES.map((s, i) => (
          <Pressable
            key={s.title}
            onPress={() => go(i)}
            accessibilityRole="button"
            accessibilityLabel={`Show slide ${i + 1}: ${s.title}`}
            hitSlop={8}
          >
            <View style={[styles.dot, i === index && styles.dotActive]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'space-between', paddingTop: 48 },
  compactWrap: { paddingTop: 20, gap: 10 },
  counter: { fontFamily: FONTS.regular, color: T.onBrand, opacity: 0.8, fontSize: 13 },
  body: { paddingVertical: 24 },
  art: { flex: 1, justifyContent: 'center', paddingBottom: 24 },
  compactBody: { minHeight: 92 },
  title: { fontFamily: FONTS.display, color: T.onBrand, fontSize: 38, fontWeight: '700', lineHeight: 46, marginBottom: 14 },
  compactTitle: { fontFamily: FONTS.bold, color: T.onBrand, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  text: { fontFamily: FONTS.regular, color: T.onBrand, fontSize: 19, lineHeight: 28, maxWidth: 520 },
  compactText: { fontFamily: FONTS.regular, color: T.onBrand, fontSize: 14, lineHeight: 20, opacity: 0.92 },
  note: { fontFamily: FONTS.regular, color: T.onBrand, opacity: 0.8, fontSize: 13, lineHeight: 19, marginTop: 20, maxWidth: 520 },
  dots: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.onBrand, opacity: 0.4 },
  dotActive: { width: 24, opacity: 1 },
});
