/**
 * THE ROOM — the ambient wash behind a screen.
 *
 * Ported from album.html's `body.songpage` background: two soft radial
 * glows tinted by the track's own pulse color, sitting over a three-stop
 * vertical wash, plus — on pages that have one — the "the record's film
 * behind everything" layer: full-bleed art or video, blurred and darkened,
 * with a vignette scrim so type stays readable over it.
 *
 * React Native has no radial-gradient primitive, so the two pulse glows are
 * large, heavily blurred, absolutely-positioned circles rather than a CSS
 * radial-gradient — visually equivalent at the sizes and blur radii used
 * here, not a different effect.
 *
 * This is what "dimensional, not flat" comes from: without it, every
 * screen is one solid color, no matter what sits on top of it.
 */
import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { ROOM_WASH, ROOM_WASH_LOCATIONS, color } from './theme';

export default function Room({
  pulse = color.ruby,
  art,
  dim = 0.6,
  children,
}: {
  /** the track/album's own accent — tints the two ambient glows */
  pulse?: string;
  /** the record's film behind everything: blurred, never sharp */
  art?: string;
  /** how dark the art sits under its scrim — Now Playing wants it darker */
  dim?: number;
  children?: React.ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const glow = Math.max(width, height) * 1.1;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={ROOM_WASH}
        locations={ROOM_WASH_LOCATIONS}
        style={StyleSheet.absoluteFill}
      />
      {art ? (
        <>
          <Image
            source={{ uri: art }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            blurRadius={38}
          />
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(10,8,7,${dim})` }]}
          />
        </>
      ) : null}
      {/* the two pulse-tinted glows, top and bottom, exactly as the wash describes */}
      <View
        style={{
          position: 'absolute',
          top: -glow * 0.55,
          left: (width - glow) / 2,
          width: glow,
          height: glow,
          borderRadius: glow / 2,
          backgroundColor: pulse,
          opacity: 0.16,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: -glow * 0.68,
          left: (width - glow) / 2,
          width: glow,
          height: glow,
          borderRadius: glow / 2,
          backgroundColor: pulse,
          opacity: 0.08,
        }}
      />
      {/* the vignette: content stays legible however bright the art is */}
      <LinearGradient
        colors={['rgba(10,8,7,0.15)', 'rgba(10,8,7,0.55)', 'rgba(10,8,7,0.92)']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}
