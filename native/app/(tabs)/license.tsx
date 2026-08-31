/**
 * LICENSE — a numbered professional brief.
 *
 * Brand library: "A request should feel like a numbered professional brief,
 * disclose the approximate effort, inherit the selected track, and end with
 * a clear desk receipt." Native mobile law: "License is a grouped task
 * flow" with "a reachable mobile primary action".
 *
 * So: numbered groups, the effort stated at the top before anything is
 * asked, the track inherited from wherever the visitor came from, one
 * primary action pinned above the bar, and a real receipt at the end.
 *
 * The numbering here is not decoration — it is a genuine sequence, and the
 * count is what discloses the effort.
 */
import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { album, trackBySlug } from '../../src/content';
import { fileBrief } from '../../src/desk';
import { color, family, radius, space, type, MIN_TOUCH } from '../../src/theme';

const USES = [
  { id: 'social', label: 'Social', note: 'Organic posts and reels' },
  { id: 'web', label: 'Website', note: 'Your own site, one year' },
  { id: 'ads', label: 'Paid media', note: 'Anything with spend behind it' },
  { id: 'film', label: 'Film or TV', note: 'Quoted on term and territory' },
];

const TERMS = [
  { id: '1y', label: 'One year' },
  { id: 'perp', label: 'In perpetuity' },
  { id: 'campaign', label: 'One campaign' },
];

export default function LicenseScreen() {
  const { track: trackParam } = useLocalSearchParams<{ track?: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const inherited = trackParam ? trackBySlug(String(trackParam)) : undefined;
  const [trackSlug, setTrackSlug] = useState(inherited?.slug ?? album.tracks[0].slug);
  const [use, setUse] = useState<string | null>(null);
  const [term, setTerm] = useState<string | null>(null);
  const [who, setWho] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  /** The server's reference, set only once the brief is genuinely filed. */
  const [filed, setFiled] = useState<{ reference: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* the inherited track wins if the visitor arrived from a room */
  React.useEffect(() => {
    if (inherited) setTrackSlug(inherited.slug);
  }, [inherited?.slug]);

  const ready = useMemo(
    () => !!use && !!term && who.trim().length > 1 && /\S+@\S+\.\S+/.test(email),
    [use, term, who, email],
  );

  if (filed) return <Receipt onDone={() => router.back()} trackSlug={trackSlug} reference={filed.reference} />;

  async function send() {
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    try {
      setFiled(await fileBrief({ trackSlug, use: use!, term: term!, who, email, note }));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Your brief was not sent. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          paddingBottom: MIN_TOUCH + space.xxl * 2,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[s.head, { paddingTop: insets.top + space.xl }]}>
          <Text style={s.kicker}>Licensing brief</Text>
          <Text style={s.title}>Four questions, then it is on the desk.</Text>
          <Text style={s.effort}>About two minutes. You get a written quote back, not a bot.</Text>
        </View>

        <Group n={1} label="The track">
          <View style={s.chips}>
            {album.tracks.map((t) => (
              <Chip
                key={t.slug}
                label={t.title}
                on={trackSlug === t.slug}
                onPress={() => setTrackSlug(t.slug)}
              />
            ))}
          </View>
        </Group>

        <Group n={2} label="Where it runs">
          {USES.map((u) => (
            <Option
              key={u.id}
              label={u.label}
              note={u.note}
              on={use === u.id}
              onPress={() => setUse(u.id)}
            />
          ))}
        </Group>

        <Group n={3} label="For how long">
          <View style={s.chips}>
            {TERMS.map((t) => (
              <Chip
                key={t.id}
                label={t.label}
                on={term === t.id}
                onPress={() => setTerm(t.id)}
              />
            ))}
          </View>
        </Group>

        <Group n={4} label="Who is asking">
          <TextInput
            style={s.input}
            placeholder="Your name"
            placeholderTextColor={color.fainter}
            value={who}
            onChangeText={setWho}
            autoComplete="name"
          />
          <TextInput
            style={s.input}
            placeholder="Email"
            placeholderTextColor={color.fainter}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <TextInput
            style={[s.input, s.area]}
            placeholder="The project, the date, the budget — whatever you have"
            placeholderTextColor={color.fainter}
            value={note}
            onChangeText={setNote}
            multiline
          />
        </Group>
      </ScrollView>

      {/* the primary action stays reachable, above the bar, always */}
      <View style={[s.dock, { paddingBottom: space.md }]}>
        {error ? (
          <Text style={s.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Pressable
          disabled={!ready || sending}
          onPress={send}
          style={[s.send, (!ready || sending) && s.sendOff]}
          accessibilityRole="button"
          accessibilityLabel="Send the brief"
          accessibilityState={{ disabled: !ready || sending, busy: sending }}
        >
          <Text style={[s.sendText, (!ready || sending) && s.sendTextOff]}>
            {sending ? 'Sending…' : ready ? 'Send it to the desk' : 'Answer all four'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Group({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <View style={s.group}>
      <View style={s.groupHead}>
        <Text style={s.groupNo}>{n}</Text>
        <Text style={s.groupLabel}>{label}</Text>
      </View>
      <View style={s.groupBody}>{children}</View>
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.chip, on && s.chipOn]}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Option({
  label,
  note,
  on,
  onPress,
}: {
  label: string;
  note: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.option, on && s.optionOn]}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label}. ${note}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={[s.optionLabel, on && { color: color.ruby }]}>{label}</Text>
        <Text style={s.optionNote}>{note}</Text>
      </View>
      <View style={[s.radio, on && s.radioOn]} />
    </Pressable>
  );
}

function Receipt({ trackSlug, onDone, reference }: { trackSlug: string; onDone: () => void; reference: string }) {
  const insets = useSafeAreaInsets();
  const t = trackBySlug(trackSlug);
  return (
    <View style={[s.screen, { paddingTop: insets.top + space.xxl, paddingHorizontal: space.gutter }]}>
      <Text style={s.kicker}>On the desk</Text>
      <Text style={s.receiptTitle}>The brief is filed.</Text>
      <Text style={s.receiptBody}>
        {t ? `“${t.title}” ` : ''}went over with your dates and your use. You get a written
        quote back, usually the same day. Nothing is licensed until you sign.
      </Text>
      <View style={s.receiptCard}>
        <Text style={s.receiptRef}>REF {reference}</Text>
      </View>
      <Pressable onPress={onDone} style={s.send} accessibilityRole="button">
        <Text style={s.sendText}>Back to the record</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.stage },
  head: { paddingHorizontal: space.gutter, paddingBottom: space.lg },
  kicker: { ...type.label, color: color.ruby },
  title: { ...type.title, color: color.paper, marginTop: space.sm },
  effort: { ...type.sub, color: color.fainter, marginTop: space.sm },

  group: { paddingHorizontal: space.gutter, paddingTop: space.xl },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  groupNo: {
    ...type.mono,
    color: color.stage,
    backgroundColor: color.paper,
    width: 20,
    height: 20,
    borderRadius: 10,
    textAlign: 'center',
    lineHeight: 20,
    overflow: 'hidden',
  },
  groupLabel: { ...type.label, color: color.paper },
  groupBody: { marginTop: space.md, gap: space.sm },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.rule,
  },
  chipOn: { backgroundColor: color.ruby, borderColor: 'transparent' },
  chipText: { ...type.sub, fontFamily: family(500), color: color.quiet },
  chipTextOn: { color: '#fff' },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    minHeight: 58,
    paddingHorizontal: space.lg,
    borderRadius: radius.frame,
    borderWidth: 1,
    borderColor: color.rule,
  },
  optionOn: { borderColor: color.ruby, backgroundColor: 'rgba(229,56,59,0.08)' },
  optionLabel: { ...type.row, color: color.paper },
  optionNote: { ...type.sub, color: color.fainter, marginTop: 1 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: color.rule,
  },
  radioOn: { borderColor: color.ruby, backgroundColor: color.ruby },

  input: {
    minHeight: MIN_TOUCH + 4,
    borderRadius: radius.frame,
    borderWidth: 1,
    borderColor: color.rule,
    paddingHorizontal: space.lg,
    color: color.paper,
    ...type.body,
  },
  area: { minHeight: 96, paddingTop: space.md, textAlignVertical: 'top' },

  dock: {
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.rule,
    backgroundColor: 'rgba(11,9,8,0.98)',
  },
  send: {
    minHeight: MIN_TOUCH + 6,
    borderRadius: radius.pill,
    backgroundColor: color.ruby,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.lg,
  },
  sendOff: { backgroundColor: color.field },
  sendText: { ...type.row, fontFamily: family(700), color: '#fff' },
  sendTextOff: { color: color.fainter },
  error: { ...type.sub, color: color.ruby, marginBottom: space.sm, textAlign: 'center' },

  receiptTitle: { ...type.display, color: color.paper, marginTop: space.md },
  receiptBody: { ...type.body, color: color.quiet, marginTop: space.lg },
  receiptCard: {
    marginTop: space.xl,
    padding: space.lg,
    backgroundColor: color.field,
    borderRadius: radius.frame,
  },
  receiptRef: { ...type.mono, color: color.gold },
});
