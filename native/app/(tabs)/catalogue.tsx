/**
 * CATALOG — the registered shelf.
 *
 * Native mobile law: "Catalogue is a touch shelf." Brand library: "Release
 * artwork and QT6KV registration data live in one information architecture."
 *
 * So the shelf pages horizontally — the one place the law allows it, because
 * these are browsable siblings — and the registration data sits underneath
 * the shelf rather than on a separate screen. Technical identifiers use
 * tabular numerals and the registered gold, per the library.
 */
import React, { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { album } from '../../src/content';
import { useTransport } from '../../src/player';
import { color, radius, space, type, MIN_TOUCH } from '../../src/theme';

export default function CatalogueScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { load } = useTransport();
  const [at, setAt] = useState(0);

  const card = Math.min(width - space.gutter * 3, 300);
  const stride = card + space.md;

  const onEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      setAt(Math.round(e.nativeEvent.contentOffset.x / stride));
    },
    [stride],
  );

  const track = album.tracks[Math.min(at, album.tracks.length - 1)];

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={{ paddingBottom: space.xxl }}
    >
      <View style={[s.head, { paddingTop: insets.top + space.xl }]}>
        <Text style={s.kicker}>Registered catalog</Text>
        <Text style={s.title}>Every side of the record, on the record.</Text>
      </View>

      {/* THE SHELF — browsable siblings, so horizontal is allowed */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={stride}
        decelerationRate="fast"
        onMomentumScrollEnd={onEnd}
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          gap: space.md,
        }}
      >
        {album.tracks.map((t, i) => (
          <Pressable
            key={t.slug}
            style={({ pressed }) => [
              s.card,
              { width: card, height: card },
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${t.title}, side ${i + 1}`}
            onPress={() => {
              load(t);
              router.push(`/track/${t.slug}`);
            }}
          >
            <Image
              source={{ uri: t.poster }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={200}
            />
            <View style={s.cardVeil} pointerEvents="none" />
            <View style={s.cardType}>
              <Text style={[s.cardKicker, { color: t.pulse }]}>{t.stage}</Text>
              <Text style={s.cardTitle} numberOfLines={2}>
                {t.title}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <View style={s.dots}>
        {album.tracks.map((t, i) => (
          <View key={t.slug} style={[s.dot, i === at && s.dotOn]} />
        ))}
      </View>

      {/* THE REGISTRATION — same architecture as the artwork above it */}
      <View style={s.reg}>
        <Text style={s.regHead}>Registration</Text>
        <Reg k="Title" v={track.title} />
        <Reg k="Album" v={album.name} />
        <Reg k="Writer" v="Matthew McCluster" />
        <Reg k="Publisher" v="McCluster Corp" />
        <Reg k="Work ID" v={`QT6KV-${String(at + 1).padStart(3, '0')}`} mono />
        <Reg k="Rights" v="Direct from the artist" />
        <Pressable
          onPress={() => router.push(`/license?track=${track.slug}`)}
          style={s.regBtn}
          accessibilityRole="button"
          accessibilityLabel={`License ${track.title}`}
        >
          <Text style={s.regBtnText}>License {track.title}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Reg({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <View style={s.regRow}>
      <Text style={s.regKey}>{k}</Text>
      <Text style={[s.regVal, mono && s.regMono]} numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.stage },
  head: { paddingHorizontal: space.gutter, paddingBottom: space.xl },
  kicker: { ...type.label, color: color.ruby },
  title: { ...type.title, color: color.paper, marginTop: space.sm },

  card: {
    backgroundColor: color.stageRaised,
    borderRadius: radius.frame,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  cardVeil: {
    ...StyleSheet.absoluteFill as object,
    backgroundColor: 'rgba(10,8,7,0.34)',
  },
  cardType: { padding: space.lg },
  cardKicker: { ...type.label, fontSize: 10 },
  cardTitle: { ...type.title, color: color.paper, marginTop: space.xs },

  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingTop: space.lg,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(244,239,230,0.24)',
  },
  dotOn: { backgroundColor: color.ruby, width: 18 },

  reg: {
    margin: space.gutter,
    padding: space.lg,
    backgroundColor: color.field,
    borderRadius: radius.frame,
  },
  regHead: { ...type.label, color: color.ruby, marginBottom: space.md },
  regRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.rule,
  },
  regKey: { ...type.sub, color: color.fainter },
  regVal: { ...type.sub, color: color.paper, flexShrink: 1, textAlign: 'right' },
  regMono: { ...type.mono, color: color.gold },
  regBtn: {
    marginTop: space.lg,
    minHeight: MIN_TOUCH,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  regBtnText: { ...type.row, color: color.paper },
});
