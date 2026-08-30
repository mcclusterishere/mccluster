/**
 * Glyphs, drawn rather than imported.
 *
 * No icon font and no vector library: the set the app needs is small, and
 * every one of these is a couple of views. It keeps the download honest and
 * it keeps the shapes on the house's own terms — square corners, solid
 * fills, the same weight as the display face.
 *
 * The library's rule holds here too: these mark action, so they take
 * `color` from the caller and default to nothing decorative.
 */
import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { color as brand } from './theme';

type G = { size?: number; color?: string; style?: ViewStyle };

/** a solid right-pointing triangle, built from a rotated square's border */
export function PlayGlyph({
  size = 18,
  color = brand.paper,
  playing = false,
}: G & { playing?: boolean }) {
  if (playing) {
    const barW = Math.max(2, Math.round(size * 0.28));
    return (
      <View style={{ flexDirection: 'row', gap: Math.round(size * 0.22) }}>
        <View style={{ width: barW, height: size, backgroundColor: color }} />
        <View style={{ width: barW, height: size, backgroundColor: color }} />
      </View>
    );
  }
  return (
    <View
      style={{
        width: 0,
        height: 0,
        borderTopWidth: size / 2,
        borderBottomWidth: size / 2,
        borderLeftWidth: size * 0.86,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        borderLeftColor: color,
        marginLeft: size * 0.12,
      }}
    />
  );
}

/** |◀ and ▶| — a triangle with its stop bar */
export function SkipGlyph({
  size = 16,
  color = brand.paper,
  back = false,
}: G & { back?: boolean }) {
  const bar = <View style={{ width: 2.5, height: size, backgroundColor: color }} />;
  const tri = (
    <View
      style={{
        width: 0,
        height: 0,
        borderTopWidth: size / 2,
        borderBottomWidth: size / 2,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        ...(back
          ? { borderRightWidth: size * 0.78, borderRightColor: color }
          : { borderLeftWidth: size * 0.78, borderLeftColor: color }),
      }}
    />
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {back ? bar : tri}
      {back ? tri : bar}
    </View>
  );
}

/** a chevron, from a rotated square with two borders */
export function Chevron({
  size = 12,
  color = brand.paper,
  direction = 'left',
}: G & { direction?: 'left' | 'right' | 'up' | 'down' }) {
  const deg = { left: 45, right: -135, up: 135, down: -45 }[direction];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderLeftWidth: 2,
        borderBottomWidth: 2,
        borderColor: color,
        transform: [{ rotate: `${deg}deg` }],
      }}
    />
  );
}

/** the five tab marks, kept as flat geometry so they read at 24pt */
export function TabGlyph({
  name,
  active,
  size = 22,
}: {
  name: 'album' | 'films' | 'catalogue' | 'license' | 'desk';
  active: boolean;
  size?: number;
}) {
  const c = active ? brand.ruby : brand.fainter;
  const s = size;

  if (name === 'album') {
    /* a record: a square frame with a centre hole */
    return (
      <View
        style={{
          width: s,
          height: s,
          borderWidth: 2,
          borderColor: c,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{ width: s * 0.28, height: s * 0.28, borderRadius: s * 0.14, backgroundColor: c }}
        />
      </View>
    );
  }
  if (name === 'films') {
    /* a frame with sprocket bars down each side */
    return (
      <View style={{ width: s, height: s, flexDirection: 'row', gap: 2 }}>
        <View style={{ width: 3, height: s, backgroundColor: c }} />
        <View style={{ flex: 1, borderWidth: 2, borderColor: c }} />
        <View style={{ width: 3, height: s, backgroundColor: c }} />
      </View>
    );
  }
  if (name === 'catalogue') {
    /* a shelf: three stacked rules of decreasing width */
    return (
      <View style={{ width: s, height: s, justifyContent: 'center', gap: 3 }}>
        <View style={{ height: 2.5, width: s, backgroundColor: c }} />
        <View style={{ height: 2.5, width: s * 0.72, backgroundColor: c }} />
        <View style={{ height: 2.5, width: s * 0.44, backgroundColor: c }} />
      </View>
    );
  }
  if (name === 'license') {
    /* a brief: a page with a folded corner */
    return (
      <View style={{ width: s * 0.82, height: s, borderWidth: 2, borderColor: c }}>
        <View
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            width: s * 0.34,
            height: s * 0.34,
            borderLeftWidth: 2,
            borderBottomWidth: 2,
            borderColor: c,
            backgroundColor: brand.stage,
          }}
        />
      </View>
    );
  }
  /* desk: a head and shoulders, squared off */
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'flex-end' }}>
      <View
        style={{
          width: s * 0.42,
          height: s * 0.42,
          borderRadius: s * 0.21,
          borderWidth: 2,
          borderColor: c,
          marginBottom: 2,
        }}
      />
      <View
        style={{
          width: s * 0.82,
          height: s * 0.36,
          borderTopLeftRadius: s * 0.4,
          borderTopRightRadius: s * 0.4,
          borderWidth: 2,
          borderBottomWidth: 0,
          borderColor: c,
        }}
      />
    </View>
  );
}
