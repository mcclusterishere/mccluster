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
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
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
  type ClipAsset,
  type ClipCampaign,
  type ClipPlatform,
  type ClipWork,
  type FeedItem,
  type NetworkBootstrap,
  type NetworkGroup,
  useActionNetworkApi,
} from './actionNetwork';
import { color, family, MIN_TOUCH, space, type } from './theme';

type ViewKey = 'feed' | 'missions' | 'clips' | 'groups' | 'record' | 'account';
const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'feed', label: 'Feed' },
  { key: 'missions', label: 'Missions' },
  { key: 'clips', label: 'Clips' },
  { key: 'groups', label: 'Groups' },
  { key: 'record', label: 'Record' },
  { key: 'account', label: 'Account' },
];

const TOUR_STEPS: { title: string; body: string; view?: ViewKey }[] = [
  {
    title: 'Welcome to the Action Network',
    body: "The place for doers. Don't just watch. Act. This takes about a minute.",
  },
  {
    title: 'Start with a mission',
    body: 'Pick one real thing to do out in the world. Join it, then go do it.',
    view: 'missions',
  },
  {
    title: 'Show your proof',
    body: 'Open the mission, record or choose proof, and submit it. A person on the desk checks it before the action is verified.',
    view: 'missions',
  },
  {
    title: 'Build your Action Record',
    body: 'Verified work earns its place here with your skills and progress. Three verified actions unlock the fellowship path.',
    view: 'record',
  },
  {
    title: 'The Action feed',
    body: 'The feed shows what people are doing and the missions attached to that work. The response is action, not likes.',
    view: 'feed',
  },
  {
    title: 'Organize in groups',
    body: 'Join rooms around the work, see their campaigns, and coordinate with the people already moving.',
    view: 'groups',
  },
  {
    title: 'Your M Account',
    body: 'Your profile, sign-out and account deletion live here. You can replay this tour from this screen any time.',
    view: 'account',
  },
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

export default function ActionNetworkScreen({ returnTo }: { returnTo?: string }) {
  const { ready, session } = useMcc();
  const router = useRouter();
  useEffect(() => {
    if (ready && session && returnTo?.startsWith('/')) router.replace(returnTo as any);
  }, [ready, session, returnTo, router]);
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
  const [tourOpen, setTourOpen] = useState(false);
  const [tourAutoChecked, setTourAutoChecked] = useState(false);

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

  useEffect(() => {
    if (!boot || tourAutoChecked || boot.next_step === 'profile') return;
    setTourAutoChecked(true);
    const context = boot.onboarding?.context || {};
    if (!context.tour_done_at) setTourOpen(true);
  }, [boot, tourAutoChecked]);

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
        {view === 'clips' ? <ClipsView /> : null}
        {view === 'groups' ? <GroupsView /> : null}
        {view === 'record' ? <RecordView /> : null}
        {view === 'account' ? (
          <AccountView
            boot={boot}
            refreshBootstrap={refreshBootstrap}
            onTour={() => setTourOpen(true)}
          />
        ) : null}
      </ScrollView>

      <NativeTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        onView={setView}
        onSeen={async () => {
          await net.markTourSeen();
          setBoot((current) =>
            current
              ? {
                  ...current,
                  onboarding: {
                    ...(current.onboarding || {}),
                    context: {
                      ...((current.onboarding?.context as Record<string, any>) || {}),
                      tour_done_at: new Date().toISOString(),
                    },
                  },
                }
              : current,
          );
        }}
      />
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

const CLIP_STATUS: Record<string, string> = {
  submitted: 'Checking on the platform',
  tracking: 'Verified · counting views',
  held: 'Under review',
  rejected: 'Not accepted',
  removed: 'Taken down',
  closed: 'Finished',
};

function usd(cents?: number | null) {
  return (
    '$' +
    (Number(cents || 0) / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function count(value?: number | null) {
  return Number(value || 0).toLocaleString('en-US');
}

function trackingLink(url?: string | null, code?: string | null, platform?: string | null) {
  if (!url || !code) return '';
  return (
    url +
    (url.includes('?') ? '&' : '?') +
    'utm_source=clip&utm_medium=' +
    encodeURIComponent(platform || 'instagram') +
    '&utm_campaign=' +
    encodeURIComponent(code)
  );
}

function openHttps(url?: string | null) {
  if (url && /^https:\/\//i.test(url)) Linking.openURL(url).catch(() => null);
}

/**
 * Paid clipping: claim a song campaign, post a Reel, paste its link. Views are
 * read from the platform by the Worker and every cent is settled by the
 * database (clip_* functions); nothing the phone reports is ever paid on.
 */
function ClipsView() {
  const net = useActionNetworkApi();
  const [campaigns, setCampaigns] = useState<ClipCampaign[]>([]);
  const [work, setWork] = useState<ClipWork | null>(null);
  const [platforms, setPlatforms] = useState<ClipPlatform[]>([]);
  const [assets, setAssets] = useState<Record<string, ClipAsset[]>>({});
  const [busy, setBusy] = useState(true);
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState('');
  const [closed, setClosed] = useState(false);
  const [accountPlatform, setAccountPlatform] = useState('instagram');
  const [handle, setHandle] = useState('');

  const load = useCallback(async () => {
    try {
      const [rows, mine, plats] = await Promise.all([
        net.clipCampaigns(),
        net.clipWork().catch(() => null),
        net.clipPlatforms().catch(() => [] as ClipPlatform[]),
      ]);
      setCampaigns(rows);
      setWork(mine);
      setPlatforms(plats);
      setClosed(false);
    } catch (e) {
      const text = errorText(e);
      if (/clip_campaigns_open|PGRST202|Could not find the function/.test(text)) setClosed(true);
      else setMessage(text);
    } finally {
      setBusy(false);
    }
  }, [net]);

  useEffect(() => {
    load();
  }, [load]);

  async function act<T>(fn: () => Promise<T>, done: (out: T) => string) {
    if (acting) return;
    setActing(true);
    setMessage('');
    try {
      setMessage(done(await fn()));
      await load();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setActing(false);
    }
  }

  const enabled = (platform: string) => platforms.some((p) => p.platform === platform && p.enabled);
  const label = (platform: string) => platforms.find((p) => p.platform === platform)?.label || platform;
  const claimOf = (missionId: string) => (work?.claims || []).find((c) => c.mission_id === missionId) || null;
  const totals = work?.totals;
  const lastPayout = (work?.payouts || [])[0];

  return (
    <Section title="Clip songs. Get paid on real views." eyebrow="Music · paid clipping">
      <Text style={s.muted}>
        Claim a campaign, post a Reel with the song, paste its link. We read the views from
        Instagram itself, so screenshots never count.
      </Text>
      {busy ? <ActivityIndicator color={color.ruby} /> : null}
      {message ? (
        <Text accessibilityRole="alert" style={s.status}>
          {message}
        </Text>
      ) : null}
      {closed ? <Empty text="Clipping is not open yet." /> : null}

      {totals ? (
        <View style={s.subsection}>
          <Text style={s.kicker}>Your clipping pay</Text>
          <View style={s.statGrid}>
            <Stat label="held" value={usd(totals.held_cents)} />
            <Stat label="payable" value={usd(totals.payable_cents)} />
            <Stat label="paid" value={usd(totals.paid_cents)} />
          </View>
          {lastPayout ? (
            <Text style={s.meta}>
              Last payout {usd(lastPayout.amount_cents)} on {dateText(lastPayout.recorded_at)}.
            </Text>
          ) : null}
          <Text style={s.meta}>
            Held pay becomes payable once the clip has stayed up, the hold period has passed and
            the artist has approved it.
          </Text>
        </View>
      ) : null}

      {!busy && !closed && !campaigns.length ? (
        <Empty text="No clipping campaigns are open right now." />
      ) : null}
      {campaigns.map((campaign) => (
        <ClipCampaignCard
          key={campaign.mission_id}
          campaign={campaign}
          claim={claimOf(campaign.mission_id)}
          files={assets[campaign.mission_id]}
          acting={acting}
          enabled={enabled}
          label={label}
          onClaim={() =>
            act(() => net.claimClip(campaign.mission_id), () => 'Claimed. Grab the files and your link below.')
          }
          onFiles={() =>
            act(
              async () => {
                const out = await net.clipAssets(campaign.mission_id);
                setAssets((current) => ({ ...current, [campaign.mission_id]: out.assets || [] }));
              },
              () => '',
            )
          }
          onSubmit={(platform, url, moment) =>
            act(
              () => net.submitClip({ missionId: campaign.mission_id, platform, url, moment }),
              () => 'Submitted. We check it on the platform before any views count.',
            )
          }
        />
      ))}

      {(work?.claims || []).length ? (
        <View style={s.subsection}>
          <Text style={s.kicker}>Your clips</Text>
          {(work?.claims || []).map((claim) => (
            <View key={claim.claim_id} style={s.compactRow}>
              <Text style={s.rowTitle}>{claim.title}</Text>
              <Text style={s.meta}>
                {usd(claim.earnings?.held_cents)} held · {usd(claim.earnings?.payable_cents)} payable ·{' '}
                {usd(claim.earnings?.paid_cents)} paid
              </Text>
              {!(claim.submissions || []).length ? <Text style={s.meta}>No clips submitted yet.</Text> : null}
              {(claim.submissions || []).map((sub) => {
                const why = sub.rejection_reason || sub.waiting_reason || sub.hold_reason || '';
                const counted = ['tracking', 'closed', 'held'].includes(sub.status);
                return (
                  <Pressable
                    key={sub.submission_id}
                    accessibilityRole="link"
                    onPress={() => openHttps(sub.url)}
                    style={s.clipSub}
                  >
                    <Text style={s.body}>
                      {label(sub.platform)} clip · {CLIP_STATUS[sub.status] || sub.status}
                      {counted ? ` · ${count(sub.verified_views)} views · ${usd(sub.earned_view_cents)}` : ''}
                      {sub.review_state === 'pending' && sub.status === 'tracking' ? ' · waiting for the artist' : ''}
                    </Text>
                    {why ? <Text style={s.meta}>{why}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}

      {!closed ? (
        <View style={s.subsection}>
          <Text style={s.kicker}>Accounts you clip from</Text>
          {(work?.accounts || []).length ? (
            (work?.accounts || []).map((account) => (
              <View key={account.account_id} style={s.compactRow}>
                <Text style={s.rowTitle}>
                  {label(account.platform)} @{account.handle}
                </Text>
                {account.verified ? (
                  <Text style={s.joined}>Verified</Text>
                ) : (
                  <>
                    <Text style={s.meta}>
                      Not verified yet. Put {account.code} in your bio, then check.
                    </Text>
                    <QuietButton
                      label="Check now"
                      disabled={acting}
                      onPress={() =>
                        act(
                          () => net.verifyClipAccount(account.account_id),
                          (out) => (out?.verified ? 'Verified.' : out?.reason || 'Not verified yet.'),
                        )
                      }
                    />
                  </>
                )}
              </View>
            ))
          ) : (
            <Text style={s.meta}>
              Add the account you post from. Pay only counts posts on accounts you have verified.
            </Text>
          )}
          <Chips
            options={platforms.map((p) => ({ value: p.platform, label: p.enabled ? p.label : `${p.label} (not yet)`, disabled: !p.enabled }))}
            value={accountPlatform}
            onChange={setAccountPlatform}
          />
          <Field
            label="Handle"
            value={handle}
            onChangeText={setHandle}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="@yourhandle"
          />
          <Pressable
            disabled={acting || !handle.trim() || !enabled(accountPlatform)}
            onPress={() =>
              act(
                async () => {
                  const out = await net.registerClipAccount(accountPlatform, handle);
                  setHandle('');
                  return out;
                },
                (out) => (out?.code ? `Put ${out.code} in your bio, then tap Check now.` : 'Added.'),
              )
            }
            style={[s.primary, (acting || !handle.trim() || !enabled(accountPlatform)) && s.disabled]}
          >
            <Text style={s.primaryText}>Add account</Text>
          </Pressable>
          <Text style={s.meta}>
            YouTube and TikTok are not connected yet, so clips there cannot be verified or paid.
          </Text>
        </View>
      ) : null}
    </Section>
  );
}

function ClipCampaignCard({
  campaign: c,
  claim,
  files,
  acting,
  enabled,
  label,
  onClaim,
  onFiles,
  onSubmit,
}: {
  campaign: ClipCampaign;
  claim: NonNullable<ClipWork['claims']>[number] | null;
  files?: ClipAsset[];
  acting: boolean;
  enabled: (platform: string) => boolean;
  label: (platform: string) => string;
  onClaim: () => void;
  onFiles: () => void;
  onSubmit: (platform: string, url: string, moment: string | null) => void;
}) {
  const open = (c.platforms || []).filter(enabled);
  const [platform, setPlatform] = useState(open[0] || '');
  const [url, setUrl] = useState('');
  const [moment, setMoment] = useState<string | null>(null);
  const song = c.song ? `${c.song.title || ''} · ${c.song.artist || ''}` : c.track?.title || '';
  const terms =
    `${usd(c.base_cpm_cents)} per 1,000 verified views after ${count(c.min_views)} views` +
    (c.per_clip_cap_cents ? ` · up to ${usd(c.per_clip_cap_cents)} a clip` : '') +
    (c.per_clipper_cap_cents ? ` · up to ${usd(c.per_clipper_cap_cents)} a clipper` : '') +
    (c.bonus_account_cents ? ` · ${usd(c.bonus_account_cents)} per new fan account` : '') +
    (c.bonus_listen_cents ? ` · ${usd(c.bonus_listen_cents)} per full listen` : '');
  const link = claim ? trackingLink(claim.link || c.song?.url, claim.ref_code, (c.platforms || [])[0]) : '';
  const canSubmit = !acting && !!platform && /^https:\/\//i.test(url.trim());

  return (
    <Article>
      <Text style={s.kicker}>
        Clip & get paid{c.creator?.artist_name ? ` · ${c.creator.artist_name}` : ''}
      </Text>
      <Text style={s.subhead}>{c.title}</Text>
      {song ? <Text style={s.muted}>{song}</Text> : null}
      <Text style={s.rowTitle}>{terms}</Text>
      <Text style={s.meta}>
        {(c.platforms || []).map(label).join(', ')} · {usd(c.budget_left_cents)} left · {count(c.clippers)} clippers
        {c.ends_at ? ` · post by ${dateText(c.ends_at)}` : ''}
      </Text>
      {c.rules ? <Text style={s.body}>{c.rules}</Text> : null}
      {(c.required_tags || []).length ? (
        <Text style={s.meta}>Your caption must include: {(c.required_tags || []).join(' ')}</Text>
      ) : null}
      <Text style={s.meta}>
        Clips must stay up {count(c.keep_live_days)} days. Pay holds {count(c.hold_days)} days
        {c.approval_mode === 'creator' ? ' and the artist approves each clip' : ''}.
      </Text>
      {!claim ? (
        <Pressable disabled={acting} onPress={onClaim} style={[s.primary, acting && s.disabled]}>
          <Text style={s.primaryText}>Claim this campaign</Text>
        </Pressable>
      ) : (
        <View style={s.actionCard}>
          <Text style={s.body}>Your link, for your bio or comments, so fans you bring are counted:</Text>
          <TextInput
            value={link}
            editable={false}
            selectTextOnFocus
            accessibilityLabel="Your tracking link"
            style={s.field}
          />
          <QuietButton label="Share link" disabled={!link} onPress={() => Share.share({ message: link }).catch(() => null)} />
          {files ? (
            <>
              {!files.length ? <Text style={s.meta}>No files for this campaign.</Text> : null}
              {files.map((file) =>
                file.url ? (
                  <Pressable key={file.id} accessibilityRole="link" onPress={() => openHttps(file.url)}>
                    <Text style={s.actionLink}>{file.label}</Text>
                  </Pressable>
                ) : (
                  <Text key={file.id} style={s.body}>
                    {file.label}
                    {file.start_ms != null
                      ? ` · ${Math.round(file.start_ms / 1000)}–${Math.round(Number(file.end_ms || 0) / 1000)}s`
                      : ''}
                  </Text>
                ),
              )}
              <Text style={s.meta}>These links expire in 15 minutes.</Text>
            </>
          ) : (
            <QuietButton label="Get the approved files" disabled={acting} onPress={onFiles} />
          )}
          {open.length ? (
            <>
              <Chips
                options={open.map((p) => ({ value: p, label: label(p) }))}
                value={platform}
                onChange={setPlatform}
              />
              <Field
                label="Link to your posted clip"
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://www.instagram.com/reel/…"
              />
              {(c.moments || []).length ? (
                <Chips
                  options={(c.moments || []).map((m) => ({ value: m.id, label: m.label }))}
                  value={moment || ''}
                  onChange={(value) => setMoment(value === moment ? null : value)}
                />
              ) : null}
              <Pressable
                disabled={!canSubmit}
                onPress={() => {
                  onSubmit(platform, url, moment);
                  setUrl('');
                }}
                style={[s.primary, !canSubmit && s.disabled]}
              >
                <Text style={s.primaryText}>Submit clip</Text>
              </Pressable>
            </>
          ) : (
            <Text style={s.meta}>None of this campaign's platforms can be verified yet.</Text>
          )}
        </View>
      )}
    </Article>
  );
}

function Chips({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; disabled?: boolean }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={s.chipRow}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: !!option.disabled }}
            disabled={option.disabled}
            onPress={() => onChange(option.value)}
            style={[s.chip, on && s.chipOn, option.disabled && s.disabled]}
          >
            <Text style={[s.chipText, on && s.chipTextOn]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
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
  onTour,
}: {
  boot: NetworkBootstrap | null;
  refreshBootstrap: () => Promise<void>;
  onTour: () => void;
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
        <QuietButton label="Take the tour" onPress={onTour} />
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

function NativeTour({
  open,
  onClose,
  onView,
  onSeen,
}: {
  open: boolean;
  onClose: () => void;
  onView: (view: ViewKey) => void;
  onSeen: () => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    const first = TOUR_STEPS[0];
    if (first.view) onView(first.view);
  }, [open, onView]);

  useEffect(() => {
    if (!open) return;
    const target = TOUR_STEPS[step]?.view;
    if (target) onView(target);
  }, [open, step, onView]);

  async function finish() {
    if (closing) return;
    setClosing(true);
    try {
      await onSeen();
    } catch {
      // The tour may still close if the account write is temporarily offline;
      // it will auto-offer again later rather than lying that the server saw it.
    } finally {
      setClosing(false);
      onClose();
    }
  }

  const item = TOUR_STEPS[step];
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={finish}
      statusBarTranslucent
    >
      <View style={s.tourScrim}>
        <View
          accessibilityRole="summary"
          accessibilityLabel={`Action Network walkthrough, step ${step + 1} of ${TOUR_STEPS.length}`}
          style={s.tourCard}
        >
          <Text style={s.kicker}>{step + 1} of {TOUR_STEPS.length}</Text>
          <Text style={s.tourTitle}>{item.title}</Text>
          <Text style={s.muted}>{item.body}</Text>
          <View style={s.tourDots}>
            {TOUR_STEPS.map((_, index) => (
              <View key={index} style={[s.tourDot, index === step && s.tourDotOn]} />
            ))}
          </View>
          <View style={s.tourButtons}>
            <Pressable disabled={closing} onPress={finish} style={s.tourSkip}>
              <Text style={s.tourSkipText}>Skip tour</Text>
            </Pressable>
            {step > 0 ? (
              <Pressable disabled={closing} onPress={() => setStep((value) => value - 1)} style={s.tourQuiet}>
                <Text style={s.tourQuietText}>Back</Text>
              </Pressable>
            ) : null}
            <Pressable
              disabled={closing}
              onPress={() => {
                if (step === TOUR_STEPS.length - 1) finish();
                else setStep((value) => value + 1);
              }}
              style={[s.tourNext, closing && s.disabled]}
            >
              <Text style={s.primaryText}>
                {closing ? 'Saving…' : step === TOUR_STEPS.length - 1 ? 'Look around' : step === 0 ? 'Show me' : 'Next'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
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

  clipSub: { minHeight: MIN_TOUCH, justifyContent: 'center', gap: 2, paddingVertical: space.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.rule,
    borderRadius: 999,
  },
  chipOn: { borderColor: color.ruby, backgroundColor: color.field },
  chipText: { ...type.sub, color: color.quiet },
  chipTextOn: { color: color.paper, fontFamily: family(700) },

  confirmRow: { minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  box: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: color.rule,
    backgroundColor: color.field,
  },
  boxOn: { backgroundColor: color.ruby, borderColor: color.ruby },
  tourScrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,.66)',
    paddingHorizontal: space.md,
    paddingBottom: space.xl,
  },
  tourCard: {
    gap: space.sm,
    padding: space.lg,
    backgroundColor: color.stageRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.rule,
    borderRadius: 18,
  },
  tourTitle: { ...type.title, color: color.paper },
  tourDots: { flexDirection: 'row', gap: 6, paddingTop: space.xs },
  tourDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.rule },
  tourDotOn: { backgroundColor: color.ruby },
  tourButtons: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  tourSkip: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingRight: space.xs },
  tourSkipText: { ...type.sub, color: color.quiet, textDecorationLine: 'underline' },
  tourQuiet: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.rule,
    borderRadius: 8,
  },
  tourQuietText: { ...type.row, color: color.paper },
  tourNext: {
    minHeight: MIN_TOUCH,
    marginLeft: 'auto',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    backgroundColor: color.ruby,
    borderRadius: 8,
  },

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
