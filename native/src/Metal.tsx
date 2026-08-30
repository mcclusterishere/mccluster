/**
 * THE METAL — the one button that gets to look like this.
 *
 * `background: var(--metal)` on .alb__play and .deckbar button.tp--play:
 * a four-stop diagonal ruby gradient with a bright specular top edge and a
 * soft ruby glow beneath it. This is the dimensional lighting the flat
 * `color.ruby` fill in the first native pass didn't have — a flat fill
 * reads as a colored rectangle; the gradient plus the two-part shadow
 * (an inset highlight, a separate tinted glow) reads as metal catching
 * light, which is what makes it feel like an object rather than a tint.
 *
 * Ruby still marks action and nothing else, per the brand library — this
 * is that same rule, rendered with the actual material instead of a flat
 * swatch of it.
 */
import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { METAL_ANGLE, METAL_COLORS, METAL_LOCATIONS, shadow } from './theme';

export function Metal({
  size,
  round = true,
  glow = true,
  onPress,
  accessibilityLabel,
  style,
  children,
}: {
  size: number;
  /** true for the transport's circular controls; false for the pill CTA */
  round?: boolean;
  /** the hero Play pill gets the outer ruby glow; small transport buttons
      get only the specular top edge, matching the two originals exactly */
  glow?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: ViewStyle | ViewStyle[];
  children?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          width: round ? size : undefined,
          height: size,
          borderRadius: round ? size / 2 : 999,
          overflow: 'hidden',
          boxShadow: glow ? shadow.metal : shadow.metalSmall,
        } as ViewStyle,
        style,
      ]}
    >
      <LinearGradient
        colors={METAL_COLORS}
        locations={METAL_LOCATIONS}
        start={METAL_ANGLE.start}
        end={METAL_ANGLE.end}
        style={[StyleSheet.absoluteFill, styles.center]}
      >
        {children}
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});

export default Metal;
