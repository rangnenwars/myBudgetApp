import React from 'react';
import Svg, { Rect } from 'react-native-svg';
import { T } from '../../constants/theme';

// The Prapanji ledger mark: a rounded tile with three ruled lines, the top
// one in the saffron accent.
export const LogoMark: React.FC<{ size?: number; color?: string }> = ({ size = 40, color = T.onBrand }) => (
  <Svg width={size} height={size} viewBox="0 0 40 40" accessibilityLabel="Prapanji logo">
    <Rect x={1.5} y={1.5} width={37} height={37} rx={9} fill="none" stroke={color} strokeWidth={2.5} />
    <Rect x={9} y={11} width={18} height={3.5} rx={1.75} fill={T.accent} />
    <Rect x={9} y={18.25} width={22} height={3.5} rx={1.75} fill={color} />
    <Rect x={9} y={25.5} width={13} height={3.5} rx={1.75} fill={color} />
  </Svg>
);
