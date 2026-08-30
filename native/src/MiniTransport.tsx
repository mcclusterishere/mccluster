/**
 * THE DECKBAR — ported, not reinterpreted.
 *
 * .deckbar: a floating rounded-22px glass card, a thin ruby-filled seek rail
 * riding its very top edge, a 40px art thumbnail, title/time, and a 40px
 * metal circular play button with prev/next flat icons beside it. The seek
 * fill and the lyric preview line both use `var(--pulse)` — the track's own
 * accent, not the house ruby — so the bar visibly belongs to whichever song
 * is playing.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { album } from './content';
import { useTransport } from './player';
import { Glass } from './Glass';
import { Metal } from './Metal';
import { color, radius, space, type } from './theme';
import { PlayGlyph } from './Glyphs';

export default function MiniTransport() {
  const { current, status, toggle, hasDeck } = useTransport();
  const router = useRouter();
  if (!hasDeck || !current) return null;

  const pct =
    status.duration > 0
      ? Math.min(100, Math.max(0, (status.currentTime / status.duration) * 100))
      : 0;
  const pulse = current.pulse;

  return (
    <Glass variant="panel" radius={22} style={s.wrap}>
      {/* the seek rail — the first thing inside the card, per the original */}
      <View style={s.seekTrack}>
        <View style={[s.seekFill, { width: `${pct}%`, backgroundColor: pulse }]} />
      </View>

      <View style={s.row}>
        <Pressable
          style={s.body}
          onPress={() => router.push(`/track/${current.slug}`)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${current.title}`}
        >
          <Image
            source={{ uri: album.art }}
            style={s.art}
            contentFit="cover"
            transition={160}
          />
          <View style={s.text}>
            <Text style={s.title} numberOfLines={1}>
              {current.title}
            </Text>
            <Text style={[s.sub, { color: pulse }]} numberOfLines={1}>
              {status.isBuffering && !status.playing ? 'Buffering' : current.stage}
            </Text>
          </View>
        </Pressable>

        <Metal
          size={40}
          glow={false}
          onPress={toggle}
          accessibilityLabel={status.playing ? 'Pause' : 'Play'}
        >
          <PlayGlyph playing={status.playing} size={15} color="#fff" />
        </Metal>
      </View>
    </Glass>
  );
}

const s = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  seekTrack: { height: 3, backgroundColor: 'rgba(244,239,230,0.14)' },
  seekFill: { height: 3 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingTop: 8,
    paddingBottom: 10,
  },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  art: { width: 40, height: 40, borderRadius: 11, backgroundColor: color.field },
  text: { flex: 1 },
  title: { ...type.row, color: color.paper },
  sub: { ...type.sub, marginTop: 1 },
});
