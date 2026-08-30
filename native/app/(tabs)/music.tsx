/**
 * ALBUM / HOME — the same room as album.html, translated for a phone.
 *
 * What's preserved from the original, verified against css/style.css and
 * album.html at the site's own source-of-truth commit rather than reworked
 * from a description of it:
 *   - the M mark, top-left, exactly where it sits on every page
 *   - "Curated by the house": the horizontal rail of the catalog, art
 *     first, ahead of the record you're inside of
 *   - the ambient wash — a pulse-tinted glow behind everything (src/Room)
 *   - the metal ruby Play pill, gradient + specular edge + tinted glow,
 *     not a flat fill
 *   - the track row that "becomes a glowing card" when it's the one
 *     playing — a left rail in the pulse color plus a soft tint, not just
 *     a color change on the text
 *
 * What's enhanced, not just carried over: the cover runs full-bleed at
 * phone width rather than the ~150px thumbnail beside the title that fits
 * a wide desktop layout. The brand library calls this "the opening field,
 * not a thumbnail beside a shelf" — an ambition that was never actually
 * built on web (album.html still uses the small thumbnail there). A phone
 * screen is exactly the single-purpose canvas that ambition describes, so
 * this is where it gets built for the first time, in the site's own
 * materials rather than a generic full-bleed hero.
 */
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { album, clock, library, M_MARK, type Track } from '../../src/content';
import { useTransport } from '../../src/player';
import { PlayGlyph } from '../../src/Glyphs';
import Room from '../../src/Room';
import { Metal } from '../../src/Metal';
import { color, family, radius, shadow, space, type, MIN_TOUCH } from '../../src/theme';

export default function AlbumScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { current, status, load, toggle } = useTransport();
  const router = useRouter();

  const nowPlaying = (t: Track) => current?.slug === t.slug;
  const leadIsLive = current && status.playing;
  const pulse = current?.pulse ?? album.tracks[0].pulse;

  return (
    <View style={s.screen}>
      <Room pulse={pulse} />
      <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }}>
        {/* THE TOP ROW — the M mark, exactly where every page keeps it */}
        <View style={[s.top, { paddingTop: insets.top + space.md }]}>
          <Image source={{ uri: M_MARK }} style={s.mMark} contentFit="contain" />
          <View style={s.topActs}>
            <View style={s.topChip} />
            <View style={s.topChip} />
          </View>
        </View>

        {/* CURATED BY THE HOUSE — the rail, ahead of the record itself */}
        <Text style={s.railLabel}>Curated by the house</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.railRow}
        >
          {library.map((entry) => (
            <View key={entry.slug} style={s.railCard}>
              <Image
                source={{ uri: entry.art }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                blurRadius={entry.slug === album.slug ? 0 : 6}
              />
              <View style={s.railVeil} />
              <Text style={s.railName} numberOfLines={2}>
                {entry.name}
              </Text>
              {entry.playable ? (
                <Metal
                  size={34}
                  glow={false}
                  style={s.railPlay}
                  accessibilityLabel={`Play ${entry.name}`}
                  onPress={() => load(album.tracks[0])}
                >
                  <PlayGlyph size={12} color="#fff" />
                </Metal>
              ) : null}
            </View>
          ))}
        </ScrollView>

        {/* THE OPENING FIELD — full-bleed on a phone's own canvas */}
        <View style={[s.cover, { height: width * 0.92 }]}>
          <Image
            source={{ uri: album.art }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={220}
          />
          <View style={s.coverVeil} pointerEvents="none" />
        </View>

        <View style={s.hero}>
          <Text style={s.kicker}>The album · {album.tracks.length} tracks</Text>
          <Text style={s.albumName} allowFontScaling={false}>
            {album.name}
          </Text>
          <Text style={s.albumBy}>
            by <Text style={s.albumByName}>Matthew McCluster</Text> · {album.by}
          </Text>

          <View style={s.actions}>
            <Metal
              size={MIN_TOUCH + 6}
              round={false}
              style={s.leadShape}
              accessibilityLabel={leadIsLive ? 'Pause the record' : 'Play the record'}
              onPress={() => (current ? toggle() : load(album.tracks[0]))}
            >
              <View style={s.leadInner}>
                <PlayGlyph playing={!!leadIsLive} size={14} color="#fff" />
                <Text style={s.leadText}>
                  {leadIsLive ? 'Pause' : current ? 'Resume' : 'Play'}
                </Text>
              </View>
            </Metal>
          </View>
        </View>

        {/* THE LIST — the playing row becomes a glowing card, per the original */}
        <View style={s.list}>
          {album.tracks.map((t, i) => {
            const live = nowPlaying(t);
            return (
              <Pressable
                key={t.slug}
                style={({ pressed }) => [
                  s.row,
                  live && { backgroundColor: `${t.pulse}1a`, boxShadow: `inset 3px 0 0 ${t.pulse}` },
                  pressed && !live && s.rowPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${t.title}. ${t.stage}.`}
                accessibilityState={{ selected: live }}
                onPress={() => {
                  load(t);
                  router.push(`/track/${t.slug}`);
                }}
              >
                <View style={s.rowNo}>
                  {live ? (
                    <PlayGlyph playing={status.playing} size={11} color={t.pulse} />
                  ) : (
                    <Text style={s.rowNoText}>{i + 1}</Text>
                  )}
                </View>

                <View style={s.rowText}>
                  <Text
                    style={[s.rowTitle, live && { color: t.pulse }]}
                    numberOfLines={1}
                  >
                    {t.title}
                  </Text>
                  <Text style={s.rowSub} numberOfLines={1}>
                    {t.sub ? `${t.sub} · ${t.stage}` : t.stage}
                  </Text>
                </View>

                <Text style={s.rowTime}>
                  {live && status.duration > 0 ? clock(status.duration) : '—'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* THE CREDIT LEDGER — part of the experience, not footer copy */}
        <View style={s.ledger}>
          <Text style={s.ledgerHead}>Credits</Text>
          <Row k="Writer" v="Matthew McCluster" />
          <Row k="Performer" v="Matthew McCluster" />
          <Row k="Producer" v="Matthew McCluster" />
          <Row k="Album" v={album.name} />
          <Row k="Registration" v="QT6KV" mono />
          <Row k="Label" v="McCluster Corp" />
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <View style={s.ledgerRow}>
      <Text style={s.ledgerKey}>{k}</Text>
      <Text style={[s.ledgerVal, mono && s.ledgerMono]}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.stage },

  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.gutter,
    paddingBottom: space.lg,
  },
  mMark: { width: 30, height: 30 },
  topActs: { flexDirection: 'row', gap: space.sm },
  topChip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(244,239,230,0.08)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)',
  },

  railLabel: {
    ...type.row,
    color: color.paper,
    paddingHorizontal: space.gutter,
    marginBottom: space.md,
  },
  railRow: { paddingHorizontal: space.gutter, gap: space.md, paddingBottom: space.xl },
  railCard: {
    width: 148,
    height: 148,
    borderRadius: radius.frame + 2,
    overflow: 'hidden',
    backgroundColor: color.stageRaised,
    justifyContent: 'space-between',
    padding: space.sm,
    boxShadow: shadow.card,
  },
  railVeil: {
    ...(StyleSheet.absoluteFill as object),
    backgroundColor: 'rgba(10,8,7,0.32)',
  },
  railName: { ...type.row, fontFamily: family(700), color: color.paper, fontSize: 14 },
  railPlay: { alignSelf: 'flex-start' },

  cover: { width: '100%', marginTop: space.sm, backgroundColor: color.stageRaised },
  coverVeil: {
    ...(StyleSheet.absoluteFill as object),
    backgroundColor: 'rgba(10,8,7,0.18)',
  },

  hero: { paddingHorizontal: space.gutter, marginTop: -space.xl },
  kicker: { ...type.label, color: color.ruby },
  albumName: {
    ...type.displayLarge,
    color: color.paper,
    marginTop: space.xs,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 8 },
    textShadowRadius: 24,
  },
  albumBy: { ...type.sub, color: color.quiet, marginTop: space.sm },
  albumByName: { color: color.paper, fontFamily: family(700) },

  actions: { marginTop: space.lg, alignItems: 'flex-start' },
  leadShape: { borderRadius: radius.pill, paddingHorizontal: space.xl },
  leadInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 2 },
  leadText: { ...type.row, fontFamily: family(700), color: '#fff' },

  list: { paddingHorizontal: space.gutter, marginTop: space.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    minHeight: 60,
    paddingHorizontal: space.sm,
    borderRadius: radius.frame,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.rule,
  },
  rowPressed: { backgroundColor: color.fieldPressed },
  rowNo: { width: 22, alignItems: 'center' },
  rowNoText: { ...type.mono, color: color.fainter },
  rowText: { flex: 1 },
  rowTitle: { ...type.row, color: color.paper },
  rowSub: { ...type.sub, color: color.fainter, marginTop: 2 },
  rowTime: { ...type.mono, color: color.fainter },

  ledger: {
    marginTop: space.xxl,
    marginHorizontal: space.gutter,
    padding: space.lg,
    backgroundColor: color.field,
    borderRadius: radius.frame,
  },
  ledgerHead: { ...type.label, color: color.ruby, marginBottom: space.md },
  ledgerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.rule,
  },
  ledgerKey: { ...type.sub, color: color.fainter },
  ledgerVal: { ...type.sub, color: color.paper, flexShrink: 1, textAlign: 'right' },
  ledgerMono: { ...type.mono, color: color.gold },
});
