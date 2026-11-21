import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Modal, Pressable, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from './i18n';
import { COLORS, RADIUS, SPACING, MODAL_ANIMATION } from '../constants/theme';
import { useLanguage } from '../context/LanguageContext';
import { useTour } from '../context/TourContext';
import { useTourTargets } from '../context/TourTargetsContext';
import { LANGUAGES, t } from '../utils/i18n';
import { TOUR_STEPS, TourStep, stepButtons, stepsFor } from '../utils/tour';
import { Rect, dimRects, isUsable, padRect, placeBubble } from '../utils/tourSpotlight';

const BUBBLE_HEIGHT_GUESS = 210;
const HIGHLIGHT_PAD = 6;
/** Where an item is scrolled to when it has to be brought into view. */
const SCROLL_TO_Y = 140;
const MEASURE_TRIES = 6;

type Found = { state: 'looking' } | { state: 'found'; hole: Rect } | { state: 'lost' };

/**
 * The first-time tour. The welcome and last steps are centred cards. The steps in between dim the real screen,
 * outline one item with an arrow and a short message, and move on with Next. If an item cannot be found or shown
 * (a very small window), that step falls back to a centred card, so the tour never points at nothing.
 * Skip is on every step but the last; it opens by itself after sign-up and can be replayed from Settings.
 */
export const TourSheet: React.FC = () => {
  const { visible, end } = useTour();
  const { lang, setLang } = useLanguage();
  const { has, measure, scrollBy } = useTourTargets();
  const screen = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [steps, setSteps] = useState<TourStep[]>([...TOUR_STEPS]);
  const [found, setFound] = useState<Found>({ state: 'looking' });
  const [bubbleHeight, setBubbleHeight] = useState(BUBBLE_HEIGHT_GUESS);
  const generation = useRef(0);

  useEffect(() => {
    if (visible) {
      setIndex(0);
      setSteps(stepsFor(() => true));
    }
  }, [visible]);

  const step = steps[index] ?? steps[0];
  const length = steps.length;
  const number = index + 1;
  const buttons = stepButtons(index, length);
  const target = step?.target;

  // Find the highlighted item for this step: measure it, scroll Home to bring it into view if it is off screen,
  // and try again a few times while the screen settles.
  useEffect(() => {
    if (!visible || !target) return;
    const mine = ++generation.current;
    setFound({ state: 'looking' });
    let tries = 0;
    const attempt = async () => {
      if (mine !== generation.current) return;
      const rect = await measure(target);
      if (mine !== generation.current) return;
      if (rect && isUsable(rect, screen)) {
        setFound({ state: 'found', hole: padRect(rect, HIGHLIGHT_PAD, screen) });
        return;
      }
      tries += 1;
      if (tries >= MEASURE_TRIES) {
        setFound({ state: 'lost' });
        return;
      }
      // Seen but off screen: scroll Home so it sits near the top, then look again.
      if (rect && rect.width > 0 && rect.height > 0) scrollBy(rect.y - SCROLL_TO_Y);
      setTimeout(attempt, 220);
    };
    attempt();
    return () => {
      generation.current += 1;
    };
  }, [visible, target, index, screen.width, screen.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the welcome card: now Home is on screen, so work out which items this person really has.
  const go = (next: number) => {
    if (index === 0 && next === 1) setSteps(stepsFor(has));
    setIndex(next);
  };

  const placement = useMemo(() => (found.state === 'found' ? placeBubble(found.hole, screen, bubbleHeight) : null), [found, screen, bubbleHeight]);

  if (!visible || !step) return null;

  const addFirst = () => {
    end('finished', length);
    router.push({ pathname: '/(tabs)', params: { quick: '1' } });
  };

  const spotlight = !!target && found.state === 'found' && !!placement;
  const looking = !!target && found.state === 'looking';

  const skip = buttons.skip ? (
    <Pressable onPress={() => end('skipped', number)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Skip tour">
      <Text style={styles.skip}>Skip tour</Text>
    </Pressable>
  ) : (
    <View />
  );

  const navButtons = (
    <View style={styles.actions}>
      {index === 0 && (
        <Pressable style={[styles.btn, styles.btnPrimary, styles.flex]} onPress={() => go(1)} accessibilityRole="button">
          <Text style={[styles.btnText, styles.btnPrimaryText]}>Start the tour</Text>
        </Pressable>
      )}
      {index > 0 && buttons.next && (
        <>
          <Pressable style={[styles.btn, styles.flex]} onPress={() => go(index - 1)} accessibilityRole="button">
            <Text style={styles.btnText}>Back</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnPrimary, styles.flex]} onPress={() => go(index + 1)} accessibilityRole="button">
            <Text style={[styles.btnText, styles.btnPrimaryText]}>Next</Text>
          </Pressable>
        </>
      )}
      {!buttons.next && (
        <View style={styles.stack}>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={addFirst} accessibilityRole="button">
            <Text style={[styles.btnText, styles.btnPrimaryText]}>Add my first spend</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => end('finished', length)} accessibilityRole="button">
            <Text style={styles.btnText}>Done</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  const progress = (
    <View style={styles.progressTrack} accessibilityElementsHidden>
      <View style={[styles.progressFill, { width: `${(number / length) * 100}%` }]} />
    </View>
  );

  return (
    // Back on Android counts as skipping; tapping outside does nothing, so it is never closed by accident.
    <Modal visible transparent statusBarTranslucent animationType={MODAL_ANIMATION} onRequestClose={() => end('skipped', number)}>
      {spotlight && found.state === 'found' && placement ? (
        <View style={styles.fill} accessibilityViewIsModal accessibilityLabel="How to use Prapanji">
          {dimRects(found.hole, screen).map((r, i) => (
            <View key={i} style={[styles.dim, { left: r.x, top: r.y, width: r.width, height: r.height }]} />
          ))}
          <View pointerEvents="none" style={[styles.outline, { left: found.hole.x, top: found.hole.y, width: found.hole.width, height: found.hole.height }]} />
          <View
            style={[styles.bubble, { left: placement.left, top: placement.top, width: placement.width }]}
            onLayout={(e) => {
              const h = Math.round(e.nativeEvent.layout.height);
              if (Math.abs(h - bubbleHeight) > 4) setBubbleHeight(h);
            }}
          >
            <View style={[styles.arrow, placement.arrow === 'up' ? styles.arrowUp : styles.arrowDown, { left: placement.arrowLeft - 8 }]} pointerEvents="none" />
            <View style={styles.top}>
              <Text style={styles.count}>{t('{n} of {total}', { n: number, total: length })}</Text>
              {skip}
            </View>
            <Text style={styles.title}>{step.title}</Text>
            <Text style={styles.body}>{step.body}</Text>
            {navButtons}
            {progress}
          </View>
        </View>
      ) : looking ? (
        <View style={[styles.fill, styles.dim]} />
      ) : (
        <View style={styles.centreBackdrop}>
          <View style={styles.card} accessibilityViewIsModal accessibilityLabel="How to use Prapanji">
            <View style={styles.top}>
              <Text style={styles.count}>{t('{n} of {total}', { n: number, total: length })}</Text>
              {skip}
            </View>
            <View style={styles.iconWrap}>
              <Ionicons name={step.icon as React.ComponentProps<typeof Ionicons>['name']} size={30} color={COLORS.accent} />
            </View>
            <Text style={styles.titleBig}>{step.title}</Text>
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

            {navButtons}
            {progress}
          </View>
        </View>
      )}
    </Modal>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  dim: { position: 'absolute', backgroundColor: COLORS.backdrop },
  outline: { position: 'absolute', borderWidth: 2, borderColor: COLORS.accent, borderRadius: RADIUS.md },
  bubble: { position: 'absolute', backgroundColor: COLORS.bg, borderRadius: RADIUS.lg, padding: SPACING.md, gap: SPACING.xs, borderWidth: 1, borderColor: COLORS.cardBorder },
  arrow: { position: 'absolute', width: 16, height: 16, backgroundColor: COLORS.bg, borderColor: COLORS.cardBorder, transform: [{ rotate: '45deg' }] },
  arrowUp: { top: -9, borderTopWidth: 1, borderLeftWidth: 1 },
  arrowDown: { bottom: -9, borderBottomWidth: 1, borderRightWidth: 1 },
  centreBackdrop: { flex: 1, backgroundColor: COLORS.backdrop, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  card: { width: '100%', maxWidth: 420, backgroundColor: COLORS.bg, borderRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 24 },
  count: { color: COLORS.textMuted, fontSize: 12 },
  skip: { color: COLORS.accent, fontSize: 14, fontWeight: '600' },
  iconWrap: { width: 56, height: 56, borderRadius: RADIUS.full, backgroundColor: COLORS.accent + '1A', alignItems: 'center', justifyContent: 'center', marginTop: SPACING.xs },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  titleBig: { color: COLORS.text, fontSize: 19, fontWeight: '700', marginTop: SPACING.xs },
  body: { color: COLORS.textMuted, fontSize: 14, lineHeight: 20 },
  langBlock: { gap: 6, marginTop: SPACING.xs },
  langLabel: { color: COLORS.textMuted, fontSize: 12 },
  langToggle: { flexDirection: 'row', alignSelf: 'flex-start', borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.full, overflow: 'hidden' },
  langOption: { paddingHorizontal: SPACING.md, paddingVertical: 6 },
  langOptionActive: { backgroundColor: COLORS.accent },
  langText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  langTextActive: { color: COLORS.onAccent },
  actions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  stack: { flex: 1, gap: SPACING.xs },
  btn: { alignItems: 'center', borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: RADIUS.md, paddingVertical: 10 },
  btnPrimary: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  btnText: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  btnPrimaryText: { color: COLORS.onAccent },
  progressTrack: { height: 3, borderRadius: 2, backgroundColor: COLORS.cardBorder, marginTop: SPACING.xs, overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: COLORS.accent },
});
