import React, { useState } from 'react';
import { LayoutChangeEvent, StyleProp, StyleSheet, Text, TextStyle, View } from 'react-native';
import { compactInr, fitAmount, fitFontSize, MIN_SCALE } from '../utils/fitAmount';

interface Props {
  /** The figure, already formatted (₹3,39,668). */
  children: string;
  style?: StyleProp<TextStyle>;
  /** The raw number. When given, a figure too long to shrink to a readable size is shown compact (₹1.2 Cr) instead. */
  value?: number;
}

/**
 * A money figure that stays on one line: it shrinks to fit the width its
 * parent gives it (a column, a tile, a card), and falls back to the compact
 * form when even the smallest readable size would not fit. Works the same on
 * the phone and on web (the font size is worked out from the measured width,
 * not from adjustsFontSizeToFit, which web ignores).
 *
 * Put it in a cell that has a width (a flex: 1 column, a card): it fills its
 * parent's width, so it must not sit in a content-sized row.
 */
export const AmountText: React.FC<Props> = ({ children, style, value }) => {
  const [width, setWidth] = useState<number | null>(null);
  const base = StyleSheet.flatten(style)?.fontSize ?? 14;
  const fit = fitAmount(base, children.length, width, value != null);
  const text = fit.useCompact && value != null ? compactInr(value) : children;
  // Re-fit the compact text too (₹1.2 Cr is short, but a narrow tile may still need a small step).
  const final = fit.useCompact ? fitAmount(base, text.length, width, false) : fit;

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Text numberOfLines={1} style={[style, { fontSize: final.fontSize }]}>
        {text}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { width: '100%', minWidth: 0 },
});

/**
 * For a row of equal columns (Income / Expense / Net savings): one size for
 * every figure, so the row looks even. Measure one column with `onLayout`;
 * if the longest figure can't shrink to a readable size, all of them switch
 * to the compact form together.
 */
export const useSharedAmounts = (base: number, items: { text: string; value: number }[]) => {
  const [width, setWidth] = useState<number | null>(null);
  const longest = Math.max(...items.map((i) => i.text.length));
  const size = fitFontSize(base, longest, width);
  const compact = size < base * MIN_SCALE;
  const texts = items.map((i) => (compact ? compactInr(i.value) : i.text));
  const final = compact ? fitFontSize(base, Math.max(...texts.map((t) => t.length)), width) : size;
  return {
    texts,
    fontSize: Math.max(final, Math.ceil(base * 0.5)),
    onLayout: (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width),
  };
};
