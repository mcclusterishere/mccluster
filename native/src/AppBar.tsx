/**
 * THE APPBAR — the house's current three-room primary bar.
 *
 * The web shell is canonical: Music · HERE · Mnet/Profile. Equity Uprise
 * and Prayer Closet are still real rooms, but they are put away from primary
 * navigation rather than occupying permanent bar slots.
 *
 * The native bar follows that same information architecture instead of
 * preserving an older five-tab snapshot. The M mark and account glyph use
 * the same owner-supplied/established assets and shapes as the web shell.
 */
import React from 'react';
import { Image, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { color, shadow, METAL_COLORS, METAL_LOCATIONS, METAL_ANGLE } from './theme';
import { LinearGradient } from 'expo-linear-gradient';

const M_MARK = require('../assets/emblems/m-mark.png');
const HM_MARK = require('../assets/emblems/hm-mark.png');

/** viewBox="0 0 45.7 24" — verbatim from the appbar's inline SVG */
export function EqLockup({ size = 22, tint }: { size?: number; tint: string }) {
  const w = size * (45.7 / 24);
  return (
    <Svg width={w} height={size} viewBox="0 0 45.7 24">
      <Path
        d="M0 5.01H11.59V8.64H3.84V12.41H10.7V16.05H3.84V20.24H11.8V24H0Z"
        fill={tint}
      />
      <Rect x="14.82" y="11.25" width="8.57" height="2.6" rx="0.5" fill={tint} />
      <Rect x="14.82" y="16.05" width="8.57" height="2.61" rx="0.5" fill={tint} />
      <Path
        d="M26.2 16.4C32 15 37.4 11.6 42 5.2"
        fill="none"
        stroke={tint}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Path d="M45.6 0.4 44.9 6.5 39.9 2.8Z" fill={tint} />
      <Rect x="25.99" y="18.8" width="4.05" height="5.2" rx="0.7" fill={tint} />
      <Rect x="31.21" y="16.88" width="3.98" height="7.12" rx="0.7" fill={tint} />
      <Rect x="36.43" y="14.06" width="4.05" height="9.94" rx="0.7" fill={tint} />
      <Rect x="41.64" y="10.63" width="4.05" height="13.37" rx="0.7" fill={tint} />
    </Svg>
  );
}

/** the account glyph, verbatim: circle cx12 cy8 r3.6 + the shoulders arc */
function ProfileGlyph({ size = 24, tint }: { size?: number; tint: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="8" r="3.6" fill="none" stroke={tint} strokeWidth={1.8} />
      <Path
        d="M4.5 20a7.5 7.5 0 0 1 15 0"
        fill="none"
        stroke={tint}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** the Music tab's two faces: a play triangle at rest, a pause bar live */
function TransportFace({ playing, tint }: { playing: boolean; tint: string }) {
  if (playing) {
    return (
      <View style={{ flexDirection: 'row', gap: 3.5 }}>
        <View style={{ width: 4, height: 14, backgroundColor: tint }} />
        <View style={{ width: 4, height: 14, backgroundColor: tint }} />
      </View>
    );
  }
  return (
    <View
      style={{
        width: 0,
        height: 0,
        borderTopWidth: 7,
        borderBottomWidth: 7,
        borderLeftWidth: 13,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        borderLeftColor: tint,
        marginLeft: 2,
      }}
    />
  );
}

export type RoomKey = 'music' | 'uprise' | 'here' | 'closet' | 'profile';

export const ROOMS: { key: RoomKey; label: string; route: string }[] = [
  { key: 'music', label: 'Music', route: '/music' },
  { key: 'here', label: 'HERE', route: '/here' },
  { key: 'profile', label: 'Mnet', route: '/profile' },
];

/**
 * One tab. Active tabs fill with the metal coin; the rest are bare emblems
 * on the glass, which is exactly how the real bar reads.
 */
export function AppBarTab({
  room,
  active,
  playing,
  onPress,
}: {
  room: RoomKey;
  active: boolean;
  playing: boolean;
  onPress: () => void;
}) {
  const tint = active ? '#fff' : color.paper;
  const label = ROOMS.find((r) => r.key === room)?.label ?? room;

  const face =
    room === 'music' ? (
      <TransportFace playing={playing} tint={tint} />
    ) : room === 'uprise' ? (
      <EqLockup size={20} tint={tint} />
    ) : room === 'here' ? (
      <Image source={M_MARK} style={s.mMark} resizeMode="contain" />
    ) : room === 'closet' ? (
      <Image source={HM_MARK} style={[s.mMark, s.hmGlow]} resizeMode="contain" />
    ) : (
      <ProfileGlyph size={23} tint={tint} />
    );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      /* the visible bar is emblems only — the label lives here, for
         screen readers, the way `.appbar__tab > span` does on the web */
      accessibilityLabel={label}
      style={s.tap}
    >
      <View style={[s.coin, active && (s.coinOn as ViewStyle)]}>
        {active ? (
          <LinearGradient
            colors={METAL_COLORS}
            locations={METAL_LOCATIONS}
            start={METAL_ANGLE.start}
            end={METAL_ANGLE.end}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        {face}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  tap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coin: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  coinOn: {
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 10px 26px -8px rgba(229,56,59,0.6)',
  },
  mMark: { width: 28, height: 28 },
  /* Prayer Closet's mark carries its own warm glow on the real bar */
  hmGlow: {
    borderRadius: 8,
    boxShadow: '0 0 12px rgba(255,92,46,0.35), 0 0 0 1px rgba(244,239,230,0.18)',
  },
});

export default AppBarTab;
