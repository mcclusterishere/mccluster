/**
 * PROFILE — the account coin on the bar.
 *
 * There is no sign-in in this app: it plays a record, shows the work, and
 * files licensing briefs, none of which need an account. So this is not a
 * stubbed account screen — it is the app's own desk: what it does, how to
 * reach the studio, and the documents a listener is entitled to.
 *
 * If accounts arrive later, they arrive here. Until then this screen is
 * finished rather than pending.
 */
import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import Room from '../../src/Room';
import { Chevron } from '../../src/Glyphs';
import { ORIGIN } from '../../src/content';
import { color, family, radius, space, type, MIN_TOUCH } from '../../src/theme';

const VERSION = Constants.expoConfig?.version ?? '1.0.0';

export default function ProfileRoom() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={s.screen}>
      <Room />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.xl,
          paddingBottom: MIN_TOUCH + space.xxl * 2,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.head}>
          <Text style={s.kicker}>The desk</Text>
          <Text style={s.title} allowFontScaling={false}>Profile</Text>
          <Text style={s.lede}>
            HERE plays the record and files licensing briefs. It does not ask you to make
            an account, and it does not track you.
          </Text>
        </View>

        <Group heading="The studio">
          <Row
            label="License a track"
            note="Pick the track, the use and the term. A written quote comes back."
            onPress={() => router.push('/license')}
          />
          <Row
            label="Hire the studio"
            note="Direction, photography, web and sound."
            external
            onPress={() => Linking.openURL(`${ORIGIN}/hire.html`)}
          />
        </Group>

        <Group heading="Your data">
          <Text style={s.plain}>
            This app stores nothing about you on your device beyond what track you were
            listening to. A licensing brief sends only what you typed into it — your name,
            your email address and your request — so the studio can quote you.
          </Text>
          <Row
            label="Privacy policy"
            external
            onPress={() => Linking.openURL(`${ORIGIN}/policy.html`)}
          />
        </Group>

        <Group heading="About">
          <Meta label="Version" value={VERSION} />
          <Meta label="Music" value="I AM HERE · Matthew McCluster" />
          <Meta label="Published by" value="McCluster Corp" />
        </Group>
      </ScrollView>
    </View>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <View style={s.group}>
      <Text style={s.groupHead}>{heading}</Text>
      <View style={s.groupBody}>{children}</View>
    </View>
  );
}

function Row({
  label, note, onPress, external,
}: { label: string; note?: string; onPress: () => void; external?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
      accessibilityRole={external ? 'link' : 'button'}
      accessibilityLabel={external ? `${label}, opens in the browser` : label}
    >
      <View style={s.rowCopy}>
        <Text style={s.rowLabel}>{label}</Text>
        {note ? <Text style={s.rowNote}>{note}</Text> : null}
      </View>
      <Chevron direction="right" size={9} color={color.fainter} />
    </Pressable>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.meta}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.stage },
  head: { paddingHorizontal: space.gutter },
  kicker: { ...type.label, color: color.ruby },
  title: { ...type.displayLarge, color: color.paper, marginTop: space.md },
  lede: { ...type.body, color: color.quiet, marginTop: space.lg },

  group: { paddingHorizontal: space.gutter, marginTop: space.xxl },
  groupHead: { ...type.label, color: color.paper },
  groupBody: { marginTop: space.lg, gap: space.sm },
  plain: { ...type.sub, color: color.quiet, marginBottom: space.sm },

  row: {
    minHeight: MIN_TOUCH + 12,
    backgroundColor: color.field,
    borderRadius: radius.frame,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  rowPressed: { backgroundColor: color.fieldPressed },
  rowCopy: { flex: 1, gap: 2 },
  rowLabel: { ...type.row, fontFamily: family(500), color: color.paper },
  rowNote: { ...type.sub, color: color.fainter },

  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.rule,
    gap: space.lg,
  },
  metaLabel: { ...type.sub, color: color.fainter },
  metaValue: { ...type.mono, color: color.paper, flexShrink: 1, textAlign: 'right' },
});
