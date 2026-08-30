/**
 * A ROOM, in the house's materials.
 *
 * Four of the five rooms on the bar — Equity Uprise, HERE, Prayer Closet,
 * Profile — have not had their content ported from the web yet. This is the
 * shared shell they open in so that tapping a coin lands somewhere that
 * looks like HERE (the ambient pulse wash, the display face, the emblem)
 * instead of a blank screen or, worse, invented filler content that would
 * read as finished when it isn't.
 *
 * It states plainly what is and is not here, and links to the live page,
 * rather than pretending. Each room replaces this shell as its content is
 * genuinely carried over.
 */
import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Room from './Room';
import { Glass } from './Glass';
import { Chevron } from './Glyphs';
import { ORIGIN } from './content';
import { color, family, radius, space, type, MIN_TOUCH } from './theme';

export default function RoomScreen({
  kicker,
  title,
  lede,
  pulse = color.ruby,
  emblem,
  page,
  ported,
  pending,
}: {
  kicker: string;
  title: string;
  lede: string;
  pulse?: string;
  emblem?: any;
  /** the live page this room mirrors */
  page: string;
  /** what genuinely works here already */
  ported?: string[];
  /** what has not been carried over yet — named, never hidden */
  pending?: string[];
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={s.screen}>
      <Room pulse={pulse} />
      <ScrollView contentContainerStyle={{ paddingBottom: 160 }}>
        <View style={[s.head, { paddingTop: insets.top + space.xl }]}>
          {emblem ? (
            <Image source={emblem} style={s.emblem} contentFit="contain" />
          ) : null}
          <Text style={[s.kicker, { color: pulse }]}>{kicker}</Text>
          <Text style={s.title} allowFontScaling={false}>
            {title}
          </Text>
          <Text style={s.lede}>{lede}</Text>
        </View>

        {ported?.length ? (
          <Glass variant="panel" radius={radius.frame + 4} style={s.card}>
            <View style={s.cardInner}>
              <Text style={[s.cardHead, { color: pulse }]}>In the app</Text>
              {ported.map((line) => (
                <Text key={line} style={s.line}>
                  {line}
                </Text>
              ))}
            </View>
          </Glass>
        ) : null}

        {pending?.length ? (
          <Glass variant="panel" radius={radius.frame + 4} style={s.card}>
            <View style={s.cardInner}>
              <Text style={s.cardHeadQuiet}>Still on the web only</Text>
              {pending.map((line) => (
                <Text key={line} style={s.line}>
                  {line}
                </Text>
              ))}
              <Pressable
                onPress={() => Linking.openURL(`${ORIGIN}/${page}`)}
                style={s.door}
                accessibilityRole="link"
                accessibilityLabel={`Open ${page} in the browser`}
              >
                <Text style={s.doorText}>Open the live room</Text>
                <Chevron direction="right" size={9} color={color.fainter} />
              </Pressable>
            </View>
          </Glass>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.stage },
  head: { paddingHorizontal: space.gutter, paddingBottom: space.lg },
  emblem: { width: 46, height: 46, marginBottom: space.md },
  kicker: { ...type.label },
  title: { ...type.displayLarge, color: color.paper, marginTop: space.xs },
  lede: { ...type.body, color: color.quiet, marginTop: space.md, maxWidth: 420 },

  card: { marginHorizontal: space.gutter, marginTop: space.lg },
  cardInner: { padding: space.lg, gap: space.sm },
  cardHead: { ...type.label, marginBottom: space.xs },
  cardHeadQuiet: { ...type.label, color: color.fainter, marginBottom: space.xs },
  line: { ...type.sub, color: color.quiet },
  door: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH,
    marginTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.rule,
  },
  doorText: { ...type.row, fontFamily: family(700), color: color.paper },
});
