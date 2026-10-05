/**
 * The Action Network, native.
 *
 * This replaces the old web-link placeholder with the same action-first
 * surfaces as mnet.js: feed, missions, groups, Action Record and account.
 * Likes/comments are intentionally absent; the network's response primitive
 * is taking and proving an action.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Room from './Room';
import { useMcc } from './mcc';
import {
  type ActionMission,
  type FeedItem,
  type NetworkBootstrap,
  type NetworkGroup,
  useActionNetworkApi,
} from './actionNetwork';
import { color, family, MIN_TOUCH, space, type } from './theme';

type ViewKey = 'feed' | 'missions' | 'groups' | 'record' | 'account';
const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'feed', label: 'Feed' },
  { key: 'missions', label: 'Missions' },
  { key: 'groups', label: 'Groups' },
  { key: 'record', label: 'Record' },
  { key: 'account', label: 'Account' },
];

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function dateText(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ActionNetworkScreen() {
  const { ready, session } = useMcc();
  if (!ready) return <Centered label="Opening the network…" />;
  if (!session) return <AuthGate />;
  return <SignedInNetwork />;
}

function Centered({ label }: { label: string }) {
  return (
    <View style={s.center}>
      <Room pulse={color.ruby} />
      <ActivityIndicator color={color.ruby} />
      <Text style={s.muted}>{label}</Text>
    </View>
  );
}

function AuthGate() {
  const { signIn, signUp } = useMcc();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'in') {
        await signIn(email, password);
      } else {
        const result = await signUp(email, password);
        if (!result.session) {
          setMessage(
            result.existing
              ? 'That email already has an account. Sign in instead.'
              : 'Check your email to confirm the account, then sign in here.',
          );
        }
      }
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.screen}>
      <Room pulse={color.ruby} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          s.authWrap,
          { paddingTop: insets.top + space.xxl, paddingBottom: 150 },
        ]}
      >
        <Text style={s.kicker}>The Action Network</Text>
        <Text style={s.hero}>DON’T JUST WATCH. ACT.</Text>
        <Text style={s.lede}>
          One M Account. Take a mission, prove the work, and build a verified Action Record.
        </Text>

        <View style={s.segment}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setMode('in')}
            style={[s.segmentButton, mode === 'in' && s.segmentOn]}
          >
            <Text style={[s.segmentText, mode === 'in' && s.segmentTextOn]}>Sign in</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setMode('up')}
            style={[s.segmentButton, mode === 'up' && s.segmentOn]}
          >
            <Text style={[s.segmentText, mode === 'up' && s.segmentTextOn]}>Create account</Text>
          </Pressable>
        </View>

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
        />

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={submit}
          style={[s.primary, busy && s.disabled]}
        >
          <Text style={s.primaryText}>
            {busy ? 'Working…' : mode === 'in' ? 'Enter the network' : 'Create M Account'}
          </Text>
        </Pressable>
        {message ? <Text style={s.status}>{message}</Text> : null}
      </ScrollView>
    </View>
  );
}

function SignedInNetwork() {
  const net = useActionNetworkApi();
  const insets = useSafeAreaInsets();
  const [boot, setBoot] = useState<NetworkBootstrap | null>(null);
  const [view, setView] = useState<ViewKey>('feed');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshBootstrap = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setBoot(await net.bootstrap());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [net]);

  useEffect(() => {
    refreshBootstrap();
  }, [refreshBootstrap]);

  if (loading && !boot) return <Centered label="Loading your Action Network…" />;
  if (boot?.next_step === 'profile') {
    return <ProfileSetup boot={boot} onDone={refreshBootstrap} />;
  }

  return (
    <View style={s.screen}>
      <Room pulse={color.ruby} />
      <ScrollView
        stickyHeaderIndices={[1]}
        contentContainerStyle={{ paddingBottom: 190 }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refreshBootstrap} tintColor={color.ruby} />
        }
      >
        <View style={[s.head, { paddingTop: insets.top + space.lg }]}>
          <Text style={s.kicker}>Action Network</Text>
          <Text style={s.title}>Move with it.</Text>
          <Text style={s.lede}>
            The feed is a doorway. Missions and verified proof are the point.
          </Text>
        </View>

        <View style={s.navWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.nav}
          >
            {VIEWS.map((item) => (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: view === item.key }}
                onPress={() => setView(item.key)}
                style={[s.navButton, view === item.key && s.navOn]}
              >
                <Text style={[s.navText, view === item.key && s.navTextOn]}>{item.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {error ? <Text style={[s.status, s.section]}>{error}</Text> : null}
        {view === 'feed' ? <FeedView /> : null}
        {view === 'missions' ? <MissionsView /> : null}
        {view === 'groups' ? <GroupsView /> : null}
        {view === 'record' ? <RecordView /> : null}
        {view === 'account' ? <AccountView boot={boot} refreshBootstrap={refreshBootstrap} /> : null}
      </ScrollView>
    </View>
  );
}

function ProfileSetup({ boot, onDone }: { boot: NetworkBootstrap; onDone: () => Promise<void> }) {
  const net = useActionNetworkApi();
  const insets = useSafeAreaInsets();
  const [handle, setHandle] = useState(String(boot.identity?.mccluster_id || ''));
  const [name, setName] = useState(String(boot.profile?.display_name || ''));
  const [headline, setHeadline] = useState(String(boot.profile?.headline || ''));
  const [bio, setBio] = useState(String(boot.profile?.bio || ''));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function save() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await net.updateProfile({
        mccluster_id: handle.trim(),
        display_name: name.trim(),
        headline: headline.trim(),
        bio: bio.trim(),
      });
      await onDone();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.screen}>
      <Room pulse={color.ruby} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          s.authWrap,
          { paddingTop: insets.top + space.xxl, paddingBottom: 160 },
        ]}
      >
        <Text style={s.kicker}>One setup</Text>
        <Text style={s.hero}>YOUR ACTION IDENTITY.</Text>
        <Text style={s.lede}>
          This is the same profile used on the web Action Network.
        </Text>
        <Field
          label="Handle"
          value={handle}
          onChangeText={setHandle}
          autoCapitalize="none"
          placeholder="your-handle"
        />
        <Field label="Display name" value={name} onChangeText={setName} />
        <Field label="Headline" value={headline} onChangeText={setHeadline} />
        <Field label="Bio" value={bio} onChangeText={setBio} multiline />
        <Pressable
          disabled={busy || !handle.trim() || !name.trim()}
          onPress={save}
          style={[s.primary, (busy || !handle.trim() || !name.trim()) && s.disabled]}
        >
          <Text style={s.primaryText}>{busy ? 'Saving…' : 'Enter the network'}</Text>
        </Pressable>
        {message ? <Text style={s.status}>{message}</Text> : null}
      </ScrollView>
    </View>
  );
}

function FeedView() {
  const net = useActionNetworkApi();
  const router = useRouter();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [moreBusy, setMoreBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setMessage('');
    try {
      const page = await net.feed(null);
      setItems(page.items || []);
      setNext(page.next_before || null);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [net]);

  useEffect(() => {
    load();
  }, [load]);

  async function more() {
    if (!next || moreBusy) return;
    setMoreBusy(true);
    try {
      const page = await net.feed(next);
      setItems((old) => old.concat(page.items || []));
      setNext(page.next_before || null);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setMoreBusy(false);
    }
  }

  function openMission(item: FeedItem) {
    const card = item.offer || item.action;
    if (!card?.mission_id) return;
    router.push({
      pathname: '/mission/[id]',
      params: {
        id: String(card.mission_id),
        content: item.offer?.content_id ? String(item.offer.content_id) : '',
        source: item.offer ? 'network' : '',
      },
    } as any);
  }

  return (
    <Section title="What people did" eyebrow="Feed">
      {busy ? <ActivityIndicator color={color.ruby} /> : null}
      {!busy && !items.length ? (
        <Empty text="Nothing on the feed yet. Take a mission and make the first move." />
      ) : null}
      {items.map((item, index) => {
        if (item.item_type === 'activity') {
          return (
            <Article key={item.post_id || `activity-${index}`}>
              <Actor actor={item.actor} when={item.occurred_at} />
              <Text style={s.body}>{item.payload?.summary || item.payload?.text || 'Action Network activity'}</Text>
            </Article>
          );
        }
        const post = item.post || {};
        const missionCard = item.offer || item.action;
        return (
          <Article key={post.id || item.post_id || `post-${index}`}>
            <Actor actor={item.actor || post.actor} when={post.created_at || item.occurred_at} />
            {post.body ? <Text style={s.body}>{post.body}</Text> : null}
            {Array.isArray(post.media) && post.media.length ? (
              <Text style={s.meta}>{post.media.length} proof/media attachment{post.media.length === 1 ? '' : 's'}</Text>
            ) : null}
            {missionCard ? (
              <Pressable onPress={() => openMission(item)} style={s.actionCard}>
                <Text style={s.kicker}>{item.action ? 'Verified action' : 'Mission attached'}</Text>
                <Text style={s.rowTitle}>{missionCard.title}</Text>
                {missionCard.description ? <Text style={s.muted}>{missionCard.description}</Text> : null}
                <Text style={s.actionLink}>
                  {missionCard.mission_open === false ? 'Mission closed' : 'Take action →'}
                </Text>
              </Pressable>
            ) : null}
          </Article>
        );
      })}
      {message ? <Text style={s.status}>{message}</Text> : null}
      {next ? (
        <QuietButton label={moreBusy ? 'Loading…' : 'Show more'} disabled={moreBusy} onPress={more} />
      ) : null}
    </Section>
  );
}

function MissionsView() {
  const net = useActionNetworkApi();
  const router = useRouter();
  const [missions, setMissions] = useState<ActionMission[]>([]);
  const [stats, setStats] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([net.missions(), net.missionStats().catch(() => [])])
      .then(([rows, statRows]) => {
        if (!live) return;
        setMissions(rows || []);
        const next: Record<string, any> = {};
        for (const row of statRows || []) if (row?.mission_id) next[row.mission_id] = row;
        setStats(next);
      })
      .catch((e) => live && setMessage(errorText(e)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [net]);

  return (
    <Section title="Pick one. Do it." eyebrow="Missions">
      {busy ? <ActivityIndicator color={color.ruby} /> : null}
      {!busy && !missions.length ? <Empty text="No open missions right now." /> : null}
      {missions.map((mission) => {
        const st = stats[mission.id] || {};
        return (
          <Pressable
            key={mission.id}
            onPress={() =>
              router.push({ pathname: '/mission/[id]', params: { id: mission.id } } as any)
            }
            style={s.listRow}
          >
            <View style={s.flex}>
              <Text style={s.kicker}>
                {mission.domain || 'community'} · difficulty {mission.difficulty || 1}
              </Text>
              <Text style={s.rowTitle}>{mission.title}</Text>
              {mission.description ? <Text style={s.muted}>{mission.description}</Text> : null}
              <Text style={s.meta}>
                {Number(st.joined || 0)} joined · {Number(st.verified || 0)} completed
                {Number(st.submitted || 0) ? ` · ${Number(st.submitted)} awaiting review` : ''}
              </Text>
            </View>
            <Text style={s.chevron}>›</Text>
          </Pressable>
        );
      })}
      {message ? <Text style={s.status}>{message}</Text> : null}
    </Section>
  );
}

function GroupsView() {
  const net = useActionNetworkApi();
  const router = useRouter();
  const [groups, setGroups] = useState<NetworkGroup[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let live = true;
    net.groups()
      .then((rows) => live && setGroups(rows))
      .catch((e) => live && setMessage(errorText(e)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [net]);

  return (
    <Section title="Organize around the work." eyebrow="Groups">
      {busy ? <ActivityIndicator color={color.ruby} /> : null}
      {!busy && !groups.length ? <Empty text="No groups are available yet." /> : null}
      {groups.map((group) => (
        <Pressable
          key={group.id}
          onPress={() =>
            router.push({ pathname: '/group/[slug]', params: { slug: group.slug } } as any)
          }
          style={s.listRow}
        >
          <View style={s.flex}>
            <View style={s.rowBetween}>
              <Text style={s.rowTitle}>{group.name}</Text>
              {group.joined ? <Text style={s.joined}>Joined</Text> : null}
            </View>
            {group.purpose ? <Text style={s.muted}>{group.purpose}</Text> : null}
            <Text style={s.meta}>
              {group.visibility === 'open'
                ? 'Open group'
                : group.visibility === 'request'
                  ? 'Approval to join'
                  : 'Invitation only'}{' '}
              · {Number(group.member_count || 0)} members
            </Text>
          </View>
          <Text style={s.chevron}>›</Text>
        </Pressable>
      ))}
      {message ? <Text style={s.status}>{message}</Text> : null}
    </Section>
  );
}

function RecordView() {
  const net = useActionNetworkApi();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let live = true;
    net.actionRecord()
      .then((out) => live && setData(out))
      .catch((e) => live && setMessage(errorText(e)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [net]);

  const record = data?.record || {};
  const missions = Array.isArray(record.missions) ? record.missions : [];
  const skills = Array.isArray(record.skills) ? record.skills : [];

  return (
    <Section title="Your Action Record" eyebrow="Verified work">
      {busy ? <ActivityIndicator color={color.ruby} /> : null}
      {!busy ? (
        <View style={s.statGrid}>
          <Stat label="Verified" value={record.verified_actions || 0} />
          <Stat label="Points" value={record.points || 0} />
          <Stat label="In progress" value={record.in_progress || 0} />
        </View>
      ) : null}

      {skills.length ? (
        <View style={s.subsection}>
          <Text style={s.subhead}>Skills</Text>
          {skills.map((skill: any) => (
            <View key={skill.skill} style={s.compactRow}>
              <Text style={s.body}>{skill.skill}</Text>
              <Text style={s.meta}>{Number(skill.xp || 0)} XP · {Number(skill.verified_actions || 0)} verified</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={s.subsection}>
        <Text style={s.subhead}>Missions</Text>
        {!missions.length && !busy ? <Empty text="Take a mission to start your record." /> : null}
        {missions.map((mission: any) => (
          <Pressable
            key={mission.assignment_id}
            onPress={() =>
              router.push({ pathname: '/mission/[id]', params: { id: mission.mission_id } } as any)
            }
            style={s.compactRow}
          >
            <Text style={s.rowTitle}>{mission.title}</Text>
            <Text style={s.meta}>
              {mission.status === 'verified'
                ? `Verified${mission.verified_at ? ` · ${dateText(mission.verified_at)}` : ''}`
                : mission.status === 'submitted'
                  ? 'Waiting for review'
                  : mission.status === 'rejected'
                    ? 'Not verified — proof can be retried'
                    : 'In progress'}
              {mission.points ? ` · +${mission.points} pts` : ''}
            </Text>
            {mission.review_note ? <Text style={s.muted}>{mission.review_note}</Text> : null}
          </Pressable>
        ))}
      </View>
      {message ? <Text style={s.status}>{message}</Text> : null}
    </Section>
  );
}

function AccountView({
  boot,
  refreshBootstrap,
}: {
  boot: NetworkBootstrap | null;
  refreshBootstrap: () => Promise<void>;
}) {
  const net = useActionNetworkApi();
  const { user, signOut } = useMcc();
  const [deletion, setDeletion] = useState<any>({});
  const [reason, setReason] = useState('');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    net.deletion().then(setDeletion).catch(() => null);
  }, [net]);

  async function requestDelete() {
    if (!sure || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const next = await net.requestDeletion(reason);
      setDeletion(next);
      setMessage('Deletion request recorded. You can cancel it while it is pending.');
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancelDelete() {
    if (busy) return;
    setBusy(true);
    try {
      const next = await net.cancelDeletion();
      setDeletion(next);
      setMessage('Your account is staying.');
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={String(boot?.profile?.display_name || 'Your account')} eyebrow="M Account">
      <Article>
        <Text style={s.rowTitle}>@{String(boot?.identity?.mccluster_id || 'member')}</Text>
        <Text style={s.muted}>{String(user?.email || '')}</Text>
        {boot?.profile?.headline ? <Text style={s.body}>{String(boot.profile.headline)}</Text> : null}
        <QuietButton label="Refresh profile" onPress={refreshBootstrap} />
        <QuietButton label="Sign out" onPress={() => signOut()} />
      </Article>

      <Article>
        <Text style={s.subhead}>Delete account</Text>
        {deletion?.status === 'pending' ? (
          <>
            <Text style={s.muted}>
              Scheduled for {dateText(deletion.due_by)}. Until then you can keep the account.
            </Text>
            <QuietButton label={busy ? 'Working…' : 'Cancel deletion'} disabled={busy} onPress={cancelDelete} />
          </>
        ) : (
          <>
            <Text style={s.muted}>
              Start deletion here. The request is recorded immediately and can be cancelled while pending.
            </Text>
            <Field
              label="Reason (optional)"
              value={reason}
              onChangeText={setReason}
              multiline
              placeholder="Anything we should know"
            />
            <Pressable onPress={() => setSure((v) => !v)} style={s.confirmRow}>
              <View style={[s.box, sure && s.boxOn]} />
              <Text style={s.body}>I understand this starts account deletion.</Text>
            </Pressable>
            <Pressable
              disabled={!sure || busy}
              onPress={requestDelete}
              style={[s.danger, (!sure || busy) && s.disabled]}
            >
              <Text style={s.dangerText}>{busy ? 'Recording…' : 'Request account deletion'}</Text>
            </Pressable>
          </>
        )}
        {message ? <Text style={s.status}>{message}</Text> : null}
      </Article>
    </Section>
  );
}

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.section}>
      <Text style={s.kicker}>{eyebrow}</Text>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.sectionBody}>{children}</View>
    </View>
  );
}

function Article({ children }: { children: React.ReactNode }) {
  return <View style={s.article}>{children}</View>;
}

function Actor({ actor, when }: { actor?: Record<string, any>; when?: string }) {
  const name =
    actor?.display_name ||
    actor?.mccluster_id ||
    actor?.handle ||
    actor?.name ||
    'Action Network member';
  return (
    <View style={s.rowBetween}>
      <Text style={s.rowTitle}>{String(name)}</Text>
      {when ? <Text style={s.meta}>{dateText(when)}</Text> : null}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{String(value)}</Text>
      <Text style={s.meta}>{label}</Text>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return <Text style={s.empty}>{text}</Text>;
}

function QuietButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[s.quietButton, disabled && s.disabled]}>
      <Text style={s.quietButtonText}>{label}</Text>
    </Pressable>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, multiline, ...input } = props;
  return (
    <View style={s.fieldWrap}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        {...input}
        multiline={multiline}
        placeholderTextColor={color.fainter}
        style={[s.field, multiline && s.fieldMulti]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.stage },
  center: {
    flex: 1,
    backgroundColor: color.stage,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xl,
  },
  flex: { flex: 1 },
  authWrap: { paddingHorizontal: space.gutter, gap: space.lg },
  head: { paddingHorizontal: space.gutter, paddingBottom: space.lg },
  kicker: { ...type.label, color: color.ruby },
  hero: { ...type.displayLarge, color: color.paper, marginTop: space.sm },
  title: { ...type.display, color: color.paper, marginTop: space.xs },
  lede: { ...type.body, color: color.quiet, marginTop: space.sm, maxWidth: 480 },
  body: { ...type.body, color: color.paper },
  muted: { ...type.body, color: color.quiet },
  meta: { ...type.sub, color: color.fainter },
  status: { ...type.sub, color: color.quiet, marginTop: space.sm },
  rowTitle: { ...type.row, fontFamily: family(700), color: color.paper },
  subhead: { ...type.title, color: color.paper },
  chevron: { fontSize: 30, color: color.fainter, paddingLeft: space.sm },

  segment: {
    flexDirection: 'row',
    padding: 4,
    backgroundColor: color.field,
    borderRadius: 12,
    marginTop: space.lg,
  },
  segmentButton: {
    flex: 1,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  segmentOn: { backgroundColor: color.stageRaised },
  segmentText: { ...type.row, color: color.quiet },
  segmentTextOn: { color: color.paper, fontFamily: family(700) },

  fieldWrap: { gap: space.xs },
  fieldLabel: { ...type.label, color: color.fainter },
  field: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.rule,
    backgroundColor: color.field,
    color: color.paper,
    fontFamily: family(400),
    fontSize: 16,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: 8,
  },
  fieldMulti: { minHeight: 96, textAlignVertical: 'top' },

  primary: {
    minHeight: 50,
    backgroundColor: color.ruby,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: 8,
  },
  primaryText: { ...type.row, fontFamily: family(700), color: '#fff' },
  disabled: { opacity: 0.45 },

  navWrap: {
    backgroundColor: color.stage,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.rule,
  },
  nav: { paddingHorizontal: space.gutter, gap: space.xs, paddingVertical: space.sm },
  navButton: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  navOn: { borderBottomColor: color.ruby },
  navText: { ...type.row, color: color.fainter },
  navTextOn: { color: color.paper, fontFamily: family(700) },

  section: { paddingHorizontal: space.gutter, paddingTop: space.xl },
  sectionTitle: { ...type.title, color: color.paper, marginTop: space.xs },
  sectionBody: { gap: space.md, marginTop: space.lg },
  subsection: { gap: space.sm, marginTop: space.md },
  article: {
    gap: space.sm,
    paddingVertical: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.rule,
  },
  listRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.rule,
  },
  compactRow: {
    gap: space.xs,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.rule,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  joined: { ...type.label, color: color.ruby },
  empty: { ...type.body, color: color.quiet, paddingVertical: space.lg },

  actionCard: {
    gap: space.xs,
    marginTop: space.sm,
    padding: space.md,
    borderLeftWidth: 2,
    borderLeftColor: color.ruby,
    backgroundColor: color.field,
  },
  actionLink: { ...type.row, color: color.ruby, fontFamily: family(700), marginTop: space.xs },

  quietButton: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.rule,
    borderRadius: 8,
  },
  quietButtonText: { ...type.row, color: color.paper, fontFamily: family(700) },

  statGrid: { flexDirection: 'row', gap: space.sm },
  stat: {
    flex: 1,
    minHeight: 84,
    justifyContent: 'center',
    padding: space.md,
    backgroundColor: color.field,
    borderTopWidth: 2,
    borderTopColor: color.ruby,
  },
  statValue: { ...type.title, color: color.paper },

  confirmRow: { minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  box: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: color.rule,
    backgroundColor: color.field,
  },
  boxOn: { backgroundColor: color.ruby, borderColor: color.ruby },
  danger: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: color.ruby,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: 8,
  },
  dangerText: { ...type.row, color: color.ruby, fontFamily: family(700) },
});
