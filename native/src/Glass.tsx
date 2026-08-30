/**
 * THE GLASS — floating system chrome.
 *
 * Ported directly from .appbar and .deckbar: a blurred, gradient-filled,
 * fully-rounded panel that FLOATS above the content with margin on every
 * side, never an edge-to-edge bar. That distinction is the single biggest
 * visual signature the first native pass lost — a flat edge-to-edge bar
 * reads as "generic app tab bar"; a floating pill with a catchlight riding
 * its top edge reads as HERE.
 *
 * Two variants, matching the two originals:
 *   panel — the deckbar's fill (rgba(32,26,21) → rgba(14,11,9))
 *   bar   — the appbar's fill, a touch darker, heavier blur+saturate
 */
import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { GLASS_FILL, radius, shadow } from './theme';

export function Glass({
  variant = 'panel',
  radius: r = radius.sheet,
  style,
  children,
}: {
  variant?: 'panel' | 'bar';
  radius?: number;
  style?: ViewStyle | ViewStyle[];
  children?: React.ReactNode;
}) {
  return (
    <View
      style={[
        {
          borderRadius: r,
          overflow: 'hidden',
          boxShadow: variant === 'bar' ? shadow.bar : shadow.panel,
        } as ViewStyle,
        style,
      ]}
    >
      <BlurView
        intensity={variant === 'bar' ? 55 : 40}
        tint="dark"
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={variant === 'bar' ? GLASS_FILL.bar : GLASS_FILL.panel}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

export default Glass;
