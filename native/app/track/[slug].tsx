/**
 * NOW PLAYING — the room the deckbar opens into.
 *
 * The original never had a dedicated full-screen player at the reference
 * commit — only the deckbar (a floating mini-transport) and, separately,
 * films.html's cinematic per-track world. This screen is the translation
 * that connects them: the deckbar's exact materials (glass, metal, pulse
 * accent) at full-screen scale, staged inside the same ambient "room" wash
 * that sits behind every songpage — blurred art filling the whole screen,
 * a crisp floating card holding the sharp photograph, exactly the way
 * `.alb__art` sits crisp against the blurred backdrop on album.html rather
 * than being one flat rectangle of image.
 *
 * The shared transport underneath — scrubber, clock, three controls,
 * credit strip — is unchanged in behavior from the first native pass; only
 * its material changed, from flat fills to the site's own metal and glass.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { album, clock, trackBySlug } from '../../src/content';
import { useTransport } from '../../src/player';
import { Chevron, PlayGlyph, SkipGlyph } from '../../src/Glyphs';
import Room from '../../src/Room';
import { Glass } from '../../src/Glass';
import { Metal } from '../../src/Metal';
import { color, radius, shadow, space, type, MIN_TOUCH, HIT_SLOP } from '../../src/theme';

export default function NowPlaying() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { current, status, toggle, seekTo, next, previous, load } = useTransport();

  const track = trackBySlug(String(slug)) ?? current;

  React.useEffect(() => {
    if (track && current?.slug !== track.slug) load(track, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.slug]);

  if (!track) return <View style={s.screen} />;

  const accent = track.pulse;
  const isThis = current?.slug === track.slug;
  const pos = isThis ? status.currentTime : 0;
  const dur = isThis ? status.duration : 0;
  const stageSize = Math.min(width - space.gutter * 2, 340);

  return (
    <View style={s.screen}>
      {/* THE ROOM — the record's own film, blurred, filling the screen behind everything */}
      <Room pulse={accent} art={track.poster} dim={0.7} />

      <View style={[s.topRow, { paddingTop: insets.top + space.sm }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={HIT_SLOP}
          style={s.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Chevron direction="down" size={13} color={color.paper} />
        </Pressable>
        <Text style={s.topLabel}>{album.name}</Text>
        <View style={s.iconBtn} />
      </View>

      <View style={s.body}>
        {/* THE STAGE — a crisp card floating in the blurred room, not a
            flat edge-to-edge image; the depth comes from that contrast */}
        <View style={[s.stage, { width: stageSize, height: stageSize }]}>
          <Image
            source={{ uri: track.poster }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={220}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,8,7,0.12)' }]} />
        </View>

        <View style={s.titleBlock}>
          <Text style={[s.stageKicker, { color: accent }]}>{track.stage}</Text>
          <Text
            style={[
              s.stageTitle,
              {
                textShadowColor: `${accent}80`,
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 28,
              },
            ]}
            allowFontScaling={false}
          >
            {track.title}
          </Text>
          {track.sub ? <Text style={s.stageSub}>{track.sub}</Text> : null}
        </View>

        {/* THE SHARED TRANSPORT */}
        <View style={s.transport}>
          <Scrubber
            position={pos}
            duration={dur}
            accent={accent}
            onSeek={seekTo}
            enabled={isThis && status.isLoaded}
          />

          <View style={s.clocks}>
            <Text style={s.clock}>{clock(pos)}</Text>
            <Text style={s.clock}>
              {status.isBuffering && isThis && !status.playing ? 'Buffering' : clock(dur)}
            </Text>
          </View>

          <View style={s.controls}>
            <Pressable
              onPress={previous}
              hitSlop={HIT_SLOP}
              style={s.side}
              accessibilityRole="button"
              accessibilityLabel="Previous track"
            >
              <SkipGlyph back size={19} color={color.paper} />
            </Pressable>

            <Metal
              size={72}
              onPress={() => (isThis ? toggle() : load(track))}
              accessibilityLabel={isThis && status.playing ? 'Pause' : 'Play'}
            >
              <PlayGlyph playing={isThis && status.playing} size={24} color="#fff" />
            </Metal>

            <Pressable
              onPress={next}
              hitSlop={HIT_SLOP}
              style={s.side}
              accessibilityRole="button"
              accessibilityLabel="Next track"
            >
              <SkipGlyph size={19} color={color.paper} />
            </Pressable>
          </View>
        </View>

        {/* THE CREDIT LEDGER — a glass card, not text floating on the room */}
        <Glass variant="panel" radius={radius.frame + 4} style={s.credit}>
          <View style={s.creditInner}>
            <Text style={s.creditLine}>{track.credit}</Text>
            <Pressable
              onPress={() => router.push(`/license?track=${track.slug}`)}
              style={s.licenseBtn}
              accessibilityRole="button"
              accessibilityLabel={`License ${track.title}`}
            >
              <Text style={s.licenseText}>License this track</Text>
              <Chevron direction="right" size={9} color={color.paper} />
            </Pressable>
          </View>
        </Glass>
      </View>
    </View>
  );
}

/**
 * A real scrubber. Measured against its own width, so a tap anywhere on the
 * track seeks there and a drag follows the thumb — the position shown while
 * dragging is local, so it does not fight the status stream on its way back.
 */
function Scrubber({
  position,
  duration,
  accent,
  onSeek,
  enabled,
}: {
  position: number;
  duration: number;
  accent: string;
  onSeek: (s: number) => void;
  enabled: boolean;
}) {
  const [w, setW] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const wRef = useRef(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    wRef.current = width;
    setW(width);
  }, []);

  const at = (x: number) => {
    const width = wRef.current || 1;
    const ratio = Math.min(1, Math.max(0, x / width));
    return ratio * (duration || 0);
  };

  const shown = drag ?? position;
  const pct = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0;

  return (
    <View
      onLayout={onLayout}
      style={s.scrubHit}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Seek"
      accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(shown) }}
      onStartShouldSetResponder={() => enabled && duration > 0}
      onMoveShouldSetResponder={() => enabled && duration > 0}
      onResponderGrant={(e) => setDrag(at(e.nativeEvent.locationX))}
      onResponderMove={(e) => setDrag(at(e.nativeEvent.locationX))}
      onResponderRelease={(e) => {
        const target = at(e.nativeEvent.locationX);
        onSeek(target);
        setDrag(null);
      }}
      onResponderTerminate={() => setDrag(null)}
    >
      <View style={s.scrubTrack}>
        <View style={[s.scrubFill, { width: w * pct, backgroundColor: accent }]} />
        <View
          style={[
            s.thumb,
            { left: Math.max(0, w * pct - 7), backgroundColor: accent },
            drag != null && s.thumbBig,
          ]}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.stage },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
  },
  iconBtn: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  topLabel: { ...type.label, color: color.paper, opacity: 0.8 },

  body: { flex: 1, alignItems: 'center', paddingHorizontal: space.gutter, paddingTop: space.lg },

  stage: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: color.stageRaised,
    boxShadow: shadow.card,
  },

  titleBlock: { width: '100%', marginTop: space.xl },
  stageKicker: { ...type.label },
  stageTitle: { ...type.display, color: color.paper, marginTop: space.sm },
  stageSub: { ...type.sub, color: color.quiet, marginTop: 4 },

  transport: { width: '100%', marginTop: space.xl },

  scrubHit: { height: 32, justifyContent: 'center' },
  scrubTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(244,239,230,0.16)',
    justifyContent: 'center',
  },
  scrubFill: { height: 4, borderRadius: 2 },
  thumb: { position: 'absolute', width: 14, height: 14, borderRadius: 7, top: -5 },
  thumbBig: { transform: [{ scale: 1.35 }] },

  clocks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  clock: { ...type.mono, color: color.fainter },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xxl,
    marginTop: space.xl,
  },
  side: { width: MIN_TOUCH + 8, height: MIN_TOUCH + 8, alignItems: 'center', justifyContent: 'center' },

  credit: { width: '100%', marginTop: 'auto', marginBottom: space.xl },
  creditInner: { padding: space.lg, gap: space.md },
  creditLine: { ...type.sub, color: color.quiet },
  licenseBtn: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH },
  licenseText: { ...type.row, color: color.paper },
});
