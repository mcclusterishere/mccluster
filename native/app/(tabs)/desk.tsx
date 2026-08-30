/**
 * THE DESK — the fifth tab.
 *
 * The bar is five tabs and the law says it is always labelled, so the fifth
 * slot has to be a real room rather than a placeholder. This is the honest
 * version of that room for the first build: what the app is, what it can do
 * on device that a page cannot, and the doors to the parts of the house that
 * have not been brought over yet.
 *
 * Signed-in state, the client console and the sales lane are the next
 * surfaces. Nothing here pretends they already exist.
 */
import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ORIGIN, album } from '../../src/content';
import { useTransport } from '../../src/player';
import { Chevron } from '../../src/Glyphs';
import { color, radius, space, type, MIN_TOUCH } from '../../src/theme';

export default function DeskScreen() {
  const insets = useSafeAreaInsets();
  const { current, status } = useTransport();

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={{ paddingBottom: space.xxl }}
    >
      <View style={[s.head, { paddingTop: insets.top + space.xl }]}>
        <Text style={s.kicker}>The desk</Text>
        <Text style={s.title}>HERE, installed.</Text>
        <Text style={s.body}>
          The record plays on device: it keeps going when the screen locks, it puts the
          artwork and the title on the lock screen, and it takes the headphone button.
          That is the part a page could never do.
        </Text>
      </View>

      <View style={s.card}>
        <Text style={s.cardHead}>On the deck</Text>
        {current ? (
          <>
            <Row k="Track" v={current.title} />
            <Row k="Album" v={album.name} />
            <Row k="State" v={status.playing ? 'Playing' : status.isLoaded ? 'Paused' : 'Loading'} />
            <Row k="Lock screen" v="Armed" />
          </>
        ) : (
          <Text style={s.empty}>Nothing loaded yet. Open Album and press play.</Text>
        )}
      </View>

      <View style={s.card}>
        <Text style={s.cardHead}>Not in this build</Text>
        <Text style={s.note}>
          The sales lane, the client console and the civic rooms are still on the web
          only. They are the next surfaces to come over, in that order.
        </Text>
        <Door label="Hire the studio" href={`${ORIGIN}/hire.html`} />
        <Door label="Client console" href={`${ORIGIN}/console.html`} />
        <Door label="Equity Uprise" href={`${ORIGIN}/equity-uprise.html`} />
      </View>

      <Text style={s.foot}>McCluster Corp · {album.name}</Text>
    </ScrollView>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowKey}>{k}</Text>
      <Text style={s.rowVal} numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}

function Door({ label, href }: { label: string; href: string }) {
  return (
    <Pressable
      onPress={() => Linking.openURL(href)}
      style={s.door}
      accessibilityRole="link"
      accessibilityLabel={`${label}, opens in the browser`}
    >
      <Text style={s.doorText}>{label}</Text>
      <Chevron direction="right" size={9} color={color.fainter} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.stage },
  head: { paddingHorizontal: space.gutter, paddingBottom: space.lg },
  kicker: { ...type.label, color: color.ruby },
  title: { ...type.display, color: color.paper, marginTop: space.sm },
  body: { ...type.body, color: color.quiet, marginTop: space.lg },

  card: {
    margin: space.gutter,
    marginBottom: 0,
    padding: space.lg,
    backgroundColor: color.field,
    borderRadius: radius.frame,
  },
  cardHead: { ...type.label, color: color.ruby, marginBottom: space.md },
  note: { ...type.sub, color: color.quiet, marginBottom: space.md },
  empty: { ...type.sub, color: color.fainter },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.rule,
  },
  rowKey: { ...type.sub, color: color.fainter },
  rowVal: { ...type.sub, color: color.paper, flexShrink: 1, textAlign: 'right' },

  door: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.rule,
  },
  doorText: { ...type.row, color: color.paper },

  foot: {
    ...type.label,
    color: color.fainter,
    textAlign: 'center',
    marginTop: space.xxl,
  },
});
