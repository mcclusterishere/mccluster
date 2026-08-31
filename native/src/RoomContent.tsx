/**
 * A ROOM, with its content actually in it.
 *
 * This replaces RoomScreen, which rendered a "Still on the web only" panel and
 * a button into Safari. Three of the five rooms on the bar used it, which made
 * them bookmarks rather than screens.
 *
 * The editorial rules are the brand library's, not new ones: rules, fields and
 * frames rather than rounded glass, which stays reserved for system chrome;
 * ruby only on action and emphasis; Anton for the room's declaration and
 * Archivo everywhere else.
 *
 * Where a room genuinely has a deeper archive on the web — the Docket 516
 * filings, the full memoranda — it is a footnote at the bottom, after the
 * room's own content, never the reason the screen exists.
 */
import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Room from './Room';
import { Chevron } from './Glyphs';
import { ORIGIN } from './content';
import type { RoomContent as Content, Entry, Stat } from './rooms';
import { color, family, radius, space, type, MIN_TOUCH } from './theme';

export default function RoomContent({
  content,
  pulse = color.ruby,
  emblem,
}: {
  content: Content;
  pulse?: string;
  emblem?: any;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={s.screen}>
      <Room pulse={pulse} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.xl,
          paddingBottom: MIN_TOUCH + space.xxl * 2,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.head}>
          {emblem ? <Image source={emblem} style={s.emblem} contentFit="contain" /> : null}
          <Text style={[s.kicker, { color: pulse }]}>{content.kicker}</Text>
          <Text style={s.title} allowFontScaling={false}>{content.title}</Text>
          <Text style={s.lede}>{content.lede}</Text>
        </View>

        {content.stats?.length ? <Stats stats={content.stats} pulse={pulse} /> : null}

        {content.sections.map((section) => (
          <View key={section.heading} style={s.section}>
            <Text style={s.sectionHead}>{section.heading}</Text>
            {section.blurb ? <Text style={s.blurb}>{section.blurb}</Text> : null}
            <View style={s.entries}>
              {section.entries.map((entry) => (
                <EntryRow key={entry.title} entry={entry} pulse={pulse} />
              ))}
            </View>
          </View>
        ))}

        {content.archive ? (
          <View style={s.archive}>
            <Text style={s.archiveNote}>{content.archive.note}</Text>
            <Pressable
              onPress={() => Linking.openURL(`${ORIGIN}/${content.archive!.page}`)}
              style={({ pressed }) => [s.door, pressed && s.doorPressed]}
              accessibilityRole="link"
              accessibilityLabel={`${content.archive.label}, opens in the browser`}
            >
              <Text style={s.doorText}>{content.archive.label}</Text>
              <Chevron direction="right" size={9} color={color.fainter} />
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Stats({ stats, pulse }: { stats: Stat[]; pulse: string }) {
  return (
    <View style={s.stats}>
      {stats.map((stat) => (
        <View key={stat.label} style={s.stat}>
          <Text style={[s.statValue, { color: pulse }]} allowFontScaling={false}>{stat.value}</Text>
          <Text style={s.statLabel}>{stat.label}</Text>
        </View>
      ))}
    </View>
  );
}

function EntryRow({ entry, pulse }: { entry: Entry; pulse: string }) {
  return (
    <View style={s.entry}>
      {entry.date ? <Text style={[s.date, { color: pulse }]}>{entry.date}</Text> : null}
      <Text style={s.entryTitle}>{entry.title}</Text>
      <Text style={s.entryBody}>{entry.body}</Text>
      {entry.meta ? <Text style={s.meta}>{entry.meta}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.stage },

  head: { paddingHorizontal: space.gutter },
  emblem: { width: 44, height: 44, marginBottom: space.lg },
  kicker: { ...type.label },
  title: { ...type.displayLarge, color: color.paper, marginTop: space.md },
  lede: { ...type.body, color: color.quiet, marginTop: space.lg },

  stats: {
    flexDirection: 'row',
    marginTop: space.xxl,
    marginHorizontal: space.gutter,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.rule,
    paddingVertical: space.lg,
    gap: space.lg,
  },
  stat: { flex: 1 },
  statValue: { fontFamily: 'Anton', fontSize: 28, lineHeight: 30, letterSpacing: 0.2 },
  statLabel: { ...type.sub, color: color.fainter, marginTop: space.xs },

  section: { paddingHorizontal: space.gutter, marginTop: space.xxl },
  sectionHead: { ...type.label, color: color.paper },
  blurb: { ...type.sub, color: color.fainter, marginTop: space.sm },
  entries: { marginTop: space.lg, gap: space.md },

  entry: {
    backgroundColor: color.field,
    borderRadius: radius.frame,
    padding: space.lg,
  },
  date: { ...type.mono, marginBottom: space.xs },
  entryTitle: { ...type.row, fontFamily: family(700), color: color.paper },
  entryBody: { ...type.sub, color: color.quiet, marginTop: space.sm },
  meta: { ...type.mono, color: color.fainter, marginTop: space.sm },

  archive: { paddingHorizontal: space.gutter, marginTop: space.xxl },
  archiveNote: { ...type.sub, color: color.fainter },
  door: {
    minHeight: MIN_TOUCH,
    marginTop: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.frame,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.rule,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  doorPressed: { backgroundColor: color.fieldPressed },
  doorText: { ...type.sub, fontFamily: family(500), color: color.paper },
});
