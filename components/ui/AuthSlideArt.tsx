import React from 'react';
import { View } from 'react-native';
import Svg, { G, Rect, Circle, Path, Line, Text as SvgText } from 'react-native-svg';
import { FONTS, T } from '../../constants/theme';

// Flat illustrations for the login slides, drawn on the brand-green panel in
// the app's own colours. They're faces-free shapes on purpose: neutral, light,
// and sharp at any size. Tints below are lighter greens of the brand colour.
const WHITE = T.onBrand;
const LIGHT = '#CFE8DE';
const MID = '#A9D5C6';
const DEEP = T.brandDeep;
const SAFFRON = T.accent;

// 1. Built for everyone: three different people around one rupee coin.
const Everyone = () => (
  <G transform="translate(-100 -120)">
    <Line x1={110} y1={332} x2={570} y2={332} stroke={WHITE} strokeOpacity={0.25} strokeWidth={2} />
    <Path d="M286 208 Q262 230 252 262" fill="none" stroke={WHITE} strokeOpacity={0.3} strokeWidth={2} strokeDasharray="4 5" />
    <Path d="M394 208 Q418 230 428 262" fill="none" stroke={WHITE} strokeOpacity={0.3} strokeWidth={2} strokeDasharray="4 5" />
    <Circle cx={340} cy={196} r={46} fill={SAFFRON} />
    <Circle cx={340} cy={196} r={36} fill="none" stroke={DEEP} strokeWidth={3} />
    <SvgText x={340} y={211} fontSize={42} fontFamily={FONTS.medium} textAnchor="middle" fill={DEEP}>
      ₹
    </SvgText>
    <Circle cx={248} cy={290} r={14} fill={MID} />
    <Rect x={230} y={306} width={36} height={26} rx={13} fill={MID} />
    <Rect x={262} y={310} width={11} height={20} rx={4} fill={SAFFRON} />
    <Circle cx={340} cy={262} r={17} fill={WHITE} />
    <Rect x={316} y={284} width={48} height={48} rx={20} fill={WHITE} />
    <Circle cx={432} cy={266} r={16} fill={LIGHT} />
    <Rect x={410} y={286} width={44} height={46} rx={19} fill={LIGHT} />
    <Circle cx={478} cy={304} r={10} fill={MID} />
    <Rect x={466} y={316} width={24} height={16} rx={8} fill={MID} />
    <Circle cx={168} cy={150} r={5} fill={SAFFRON} />
    <Circle cx={520} cy={170} r={4} fill={SAFFRON} />
    <Circle cx={130} cy={230} r={4} fill={WHITE} opacity={0.5} />
  </G>
);

// 2. Parents: a parent and child look at a budget on one phone.
const Parents = () => (
  <G>
    <Line x1={40} y1={188} x2={440} y2={188} stroke={WHITE} strokeOpacity={0.25} strokeWidth={2} />
    <Path d="M178 112 Q196 132 208 130" fill="none" stroke={WHITE} strokeWidth={10} strokeLinecap="round" />
    <Path d="M312 142 Q296 152 276 142" fill="none" stroke={MID} strokeWidth={8} strokeLinecap="round" />
    <Circle cx={150} cy={62} r={20} fill={WHITE} />
    <Rect x={122} y={86} width={56} height={102} rx={24} fill={WHITE} />
    <Circle cx={332} cy={102} r={15} fill={MID} />
    <Rect x={312} y={120} width={40} height={68} rx={18} fill={MID} />
    <Rect x={205} y={66} width={70} height={120} rx={12} fill={DEEP} stroke={WHITE} strokeWidth={2} />
    <Rect x={217} y={86} width={46} height={8} rx={4} fill={WHITE} opacity={0.3} />
    <Rect x={217} y={86} width={30} height={8} rx={4} fill={SAFFRON} />
    <Rect x={217} y={110} width={34} height={4} rx={2} fill={WHITE} />
    <Rect x={217} y={124} width={46} height={4} rx={2} fill={WHITE} opacity={0.6} />
    <Rect x={217} y={138} width={26} height={4} rx={2} fill={WHITE} opacity={0.6} />
    <Circle cx={240} cy={166} r={9} fill={SAFFRON} />
  </G>
);

// 3. Better choices: pause before the purchase, check what's left.
const Choices = () => (
  <G>
    <Line x1={30} y1={190} x2={450} y2={190} stroke={WHITE} strokeOpacity={0.25} strokeWidth={2} />
    <Path d="M115 92 V82 Q135 52 155 82 V92" fill="none" stroke={WHITE} strokeWidth={6} strokeLinecap="round" />
    <Rect x={88} y={92} width={94} height={98} rx={10} fill={WHITE} />
    <Circle cx={135} cy={46} r={22} fill={SAFFRON} />
    <Rect x={126} y={36} width={6} height={20} rx={2} fill={DEEP} />
    <Rect x={138} y={36} width={6} height={20} rx={2} fill={DEEP} />
    <Path d="M190 142 H246" fill="none" stroke={WHITE} strokeOpacity={0.45} strokeWidth={2} strokeDasharray="4 5" />
    <Rect x={252} y={64} width={190} height={118} rx={14} fill={DEEP} stroke={WHITE} strokeOpacity={0.4} strokeWidth={2} />
    <SvgText x={270} y={94} fontSize={13} fontFamily={FONTS.regular} fill={WHITE} opacity={0.8}>
      ₹ left this month
    </SvgText>
    <SvgText x={270} y={132} fontSize={30} fontFamily={FONTS.bold} fill={WHITE}>
      ₹6,400
    </SvgText>
    <Rect x={270} y={148} width={154} height={8} rx={4} fill={WHITE} opacity={0.25} />
    <Rect x={270} y={148} width={100} height={8} rx={4} fill={SAFFRON} />
  </G>
);

// 4. Same pocket money, two paths: Asha saves, Ravi ends the month at zero.
const TwoPaths = () => (
  <G transform="scale(0.85) translate(-40 -575)">
    <Line x1={340} y1={565} x2={340} y2={720} stroke={WHITE} strokeOpacity={0.3} strokeWidth={2} strokeDasharray="5 6" />
    <Rect x={58} y={672} width={26} height={30} rx={4} fill={WHITE} opacity={0.9} />
    <Rect x={92} y={646} width={26} height={56} rx={4} fill={WHITE} opacity={0.9} />
    <Rect x={126} y={618} width={26} height={84} rx={4} fill={WHITE} opacity={0.9} />
    <Rect x={160} y={588} width={26} height={114} rx={4} fill={SAFFRON} />
    <Rect x={228} y={614} width={52} height={88} rx={9} fill={DEEP} stroke={WHITE} strokeWidth={2} />
    <Circle cx={254} cy={654} r={15} fill={SAFFRON} />
    <Path d="M247 654 L252 659 L262 648" fill="none" stroke={DEEP} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    <SvgText x={170} y={726} fontSize={16} textAnchor="middle" fontFamily={FONTS.bold} fill={WHITE}>
      Asha
    </SvgText>
    <SvgText x={170} y={744} fontSize={13} textAnchor="middle" fontFamily={FONTS.regular} fill={WHITE}>
      phone in 3 months, no loan
    </SvgText>
    <Rect x={434} y={640} width={100} height={62} rx={10} fill="none" stroke={WHITE} strokeWidth={2} />
    <Path d="M434 660 H534" stroke={WHITE} strokeWidth={2} />
    <Circle cx={518} cy={672} r={5} fill={WHITE} />
    <SvgText x={470} y={688} fontSize={16} fontFamily={FONTS.medium} fill={WHITE} opacity={0.85}>
      ₹0
    </SvgText>
    <Rect x={566} y={616} width={46} height={86} rx={9} fill="none" stroke={WHITE} strokeOpacity={0.6} strokeWidth={2} strokeDasharray="4 4" />
    <Rect x={552} y={600} width={60} height={28} rx={6} fill={SAFFRON} />
    <SvgText x={582} y={619} fontSize={14} textAnchor="middle" fontFamily={FONTS.bold} fill={DEEP}>
      EMI
    </SvgText>
    <SvgText x={510} y={726} fontSize={16} textAnchor="middle" fontFamily={FONTS.bold} fill={WHITE}>
      Ravi
    </SvgText>
    <SvgText x={510} y={744} fontSize={13} textAnchor="middle" fontFamily={FONTS.regular} fill={WHITE}>
      month ends at zero, phone on EMI
    </SvgText>
  </G>
);

// 5. Start young: habits stack up like steps, each age a little higher.
const STEPS = [
  { age: '15', text: 'Track spending', h: 64 },
  { age: '20', text: 'Save and invest', h: 96 },
  { age: '25', text: 'Safety net', h: 128 },
  { age: '30', text: 'Goals funded', h: 160 },
];
const StartYoung = () => (
  <G>
    {STEPS.map((s, i) => {
      const x = 10 + i * 110;
      const top = 210 - s.h;
      const last = i === STEPS.length - 1;
      return (
        <G key={s.age}>
          <Rect x={x} y={top} width={100} height={s.h} rx={8} fill={last ? SAFFRON : WHITE} opacity={last ? 1 : 0.9 - i * 0.12} />
          <SvgText x={x + 50} y={top + 32} fontSize={24} textAnchor="middle" fontFamily={FONTS.bold} fill={DEEP}>
            {s.age}
          </SvgText>
          <SvgText x={x + 50} y={top + 52} fontSize={12} textAnchor="middle" fontFamily={FONTS.medium} fill={DEEP}>
            {s.text}
          </SvgText>
          <Circle cx={x + 50} cy={top - 14} r={6 + i * 3} fill={last ? SAFFRON : MID} />
        </G>
      );
    })}
  </G>
);

const ART: { w: number; h: number; node: React.ReactNode }[] = [
  { w: 480, h: 220, node: <Everyone /> },
  { w: 480, h: 200, node: <Parents /> },
  { w: 480, h: 200, node: <Choices /> },
  { w: 490, h: 150, node: <TwoPaths /> },
  { w: 460, h: 220, node: <StartYoung /> },
];

export const AuthSlideArt: React.FC<{ index: number }> = ({ index }) => {
  const art = ART[index];
  if (!art) return null;
  return (
    <View style={{ width: '100%', maxWidth: 480, aspectRatio: art.w / art.h }} aria-hidden>
      <Svg width="100%" height="100%" viewBox={`0 0 ${art.w} ${art.h}`}>
        {art.node}
      </Svg>
    </View>
  );
};
