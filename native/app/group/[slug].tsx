import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Room from '../../src/Room';
import { useMcc } from '../../src/mcc';
import { type FeedItem, type NetworkGroup, useActionNetworkApi } from '../../src/actionNetwork';
import { color, family, MIN_TOUCH, space, type } from '../../src/theme';

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function actorName(item: FeedItem) {
  const actor = item.actor || item.post?.actor || {};
  return actor.display_name || actor.mccluster_id || actor.handle || 'Action Network member';
}

export default function GroupScreen() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = one(params.slug);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ready, session } = useMcc();
  const net = useActionNetworkApi();

  const [group, setGroup] = useState<NetworkGroup | null>(null);
  const [organization, setOrganization] = useState<any>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [requested, setRequested] = useState(false);
  const [post, setPost] = useState('');
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!ready || !session || !slug) return;
    setBusy(true);
    setMessage('');
    try {
      const out = await net.group(slug);
      setGroup(out.group);
      setOrganization(out.organization || null);
      setCampaigns(out.campaigns || []);
      setItems(out.items || []);
    } catch (error) {
      setMessage(messageOf(error));
    } finally {
      setBusy(false);
    }
  }, [net, ready, session, slug]);

  useEffect(() => {
    load();
  }, [load]);

  async function membership() {
    if (!group || working || requested) return;
    setWorking(true);
    setMessage('');
    try {
      const out = await net.setGroupMembership(group.slug, !group.joined);
      setRequested(!!out.requested);
      setGroup({ ...group, joined: !!out.joined });
      if (out.joined) await load();
      else if (group.joined) setItems([]);
    } catch (error) {
      setMessage(messageOf(error));
    } finally {
      setWorking(false);
    }
  }

  async function publish() {
    const body = post.trim();
    if (!group?.joined || !body || working) return;
    setWorking(true);
    setMessage('Posting…');
    try {
      await net.createPost(body, group.id);
      setPost('');
      setMessage('');
      await load();
    } catch (error) {
      setMessage(messageOf(error));
    } finally {
      setWorking(false);
    }
  }

  if (!ready) {
    return (
      <View style={s.loading}>
        <Room pulse={color.ruby} />
        <ActivityIndicator color={color.ruby} />
        <Text style={s.muted}>Opening group…</Text>
      </View>
    );
  }

  if (!session) {
    return (
      <View style={s.screen}>
        <Room pulse={color.ruby} />
        <View style={[s.shell, { paddingTop: insets.top + space.md }]}>
          <Back onPress={() => router.back()} />
          <Text style={s.kicker}>Action Network</Text>
          <Text style={s.title}>SIGN IN TO OPEN THIS GROUP.</Text>
          <Pressable onPress={() => router.replace({ pathname: '/profile', params: { returnTo: `/group/${slug}` } } as any)} style={s.primary}>
            <Text style={s.primaryText}>Sign in to continue</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (busy) {
    return (
      <View style={s.loading}>
        <Room pulse={color.ruby} />
        <ActivityIndicator color={color.ruby} />
        <Text style={s.muted}>Opening group…</Text>
      </View>
    );
  }

  if (!group) {
    return (
      <View style={s.screen}>
        <Room pulse={color.ruby} />
        <View style={[s.shell, { paddingTop: insets.top + space.md }]}>
          <Back onPress={() => router.back()} />
          <Text style={s.kicker}>Action Network</Text>
          <Text style={s.title}>GROUP UNAVAILABLE.</Text>
          <Text style={s.muted}>{message || 'That group could not be opened.'}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <Room pulse={color.ruby} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          paddingBottom: insets.bottom + space.xxl,
        }}
      >
        <View style={s.top}>
          <Back onPress={() => router.back()} />
        </View>

        <View style={s.hero}>
          <Text style={s.kicker}>
            {group.visibility === 'open'
              ? 'Open group'
              : group.visibility === 'request'
                ? 'Approval to join'
                : 'Invitation only'}{' '}
            · {Number(group.member_count || 0)} members
          </Text>
          <Text style={s.title}>{group.name}</Text>
          {group.purpose ? <Text style={s.lede}>{group.purpose}</Text> : null}

          <Pressable
            disabled={working || requested}
            onPress={membership}
            style={[s.join, (working || requested) && s.disabled]}
          >
            <Text style={s.joinText}>
              {working
                ? 'Working…'
                : requested
                  ? 'Request sent'
                  : group.joined
                    ? 'Leave group'
                    : group.visibility === 'request'
                      ? 'Request to join'
                      : 'Join this group'}
            </Text>
          </Pressable>
        </View>

        {organization ? (
          <View style={s.section}>
            <Text style={s.kicker}>Organization</Text>
            <Text style={s.rowTitle}>{organization.name}</Text>
            {organization.verification_state === 'verified' ? (
              <Text style={s.verified}>Verified organization</Text>
            ) : null}
          </View>
        ) : null}

        {campaigns.length ? (
          <View style={s.section}>
            <Text style={s.kicker}>Campaigns</Text>
            {campaigns.map((campaign) => (
              <View key={campaign.id} style={s.campaign}>
                <Text style={s.rowTitle}>{campaign.title}</Text>
                {campaign.headline ? <Text style={s.muted}>{campaign.headline}</Text> : null}
                <Text style={s.meta}>
                  {campaign.current_phase || campaign.status}
                  {campaign.people_goal ? ` · goal ${campaign.people_goal} people` : ''}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {group.joined ? (
          <View style={s.section}>
            <Text style={s.kicker}>Post to the group</Text>
            <TextInput
              value={post}
              onChangeText={setPost}
              multiline
              placeholder="What action is happening?"
              placeholderTextColor={color.fainter}
              style={s.composer}
            />
            <Pressable
              disabled={working || !post.trim()}
              onPress={publish}
              style={[s.primary, (working || !post.trim()) && s.disabled]}
            >
              <Text style={s.primaryText}>{working ? 'Working…' : 'Post'}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={s.section}>
          <Text style={s.kicker}>Group feed</Text>
          {!group.joined ? (
            <Text style={s.empty}>Join to see what gets posted here, and to post yourself.</Text>
          ) : !items.length ? (
            <Text style={s.empty}>Nothing here yet. Be the first to say what is happening.</Text>
          ) : (
            items.map((item, index) => {
              const postData = item.post || {};
              return (
                <View key={postData.id || item.post_id || index} style={s.post}>
                  <Text style={s.rowTitle}>{String(actorName(item))}</Text>
                  {postData.body ? <Text style={s.body}>{String(postData.body)}</Text> : null}
                  {Array.isArray(postData.media) && postData.media.length ? (
                    <Text style={s.meta}>
                      {postData.media.length} proof/media attachment
                      {postData.media.length === 1 ? '' : 's'}
                    </Text>
                  ) : null}
                </View>
              );
            })
          )}
        </View>

        {message ? <Text style={s.status}>{message}</Text> : null}
      </ScrollView>
    </View>
  );
}

function Back({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.back}>
      <Text style={s.backText}>‹ Back</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.stage },
  loading: {
    flex: 1,
    backgroundColor: color.stage,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  shell: { flex: 1, paddingHorizontal: space.gutter, gap: space.md },
  top: { paddingHorizontal: space.gutter },
  back: { minHeight: MIN_TOUCH, alignSelf: 'flex-start', justifyContent: 'center', paddingRight: space.lg },
  backText: { ...type.row, color: color.paper },
  hero: { paddingHorizontal: space.gutter, paddingVertical: space.lg, gap: space.sm },
  kicker: { ...type.label, color: color.ruby },
  title: { ...type.display, color: color.paper },
  lede: { ...type.body, color: color.quiet, maxWidth: 520 },
  body: { ...type.body, color: color.paper },
  muted: { ...type.body, color: color.quiet },
  meta: { ...type.sub, color: color.fainter },
  rowTitle: { ...type.row, fontFamily: family(700), color: color.paper },
  verified: { ...type.label, color: color.ruby },
  join: {
    minHeight: 48,
    marginTop: space.sm,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderWidth: 1,
    borderColor: color.ruby,
    borderRadius: 8,
  },
  joinText: { ...type.row, color: color.ruby, fontFamily: family(700) },
  disabled: { opacity: 0.45 },
  section: {
    marginHorizontal: space.gutter,
    paddingVertical: space.xl,
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.rule,
  },
  campaign: {
    gap: space.xs,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.rule,
  },
  composer: {
    minHeight: 100,
    textAlignVertical: 'top',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.rule,
    backgroundColor: color.field,
    color: color.paper,
    fontFamily: family(400),
    fontSize: 16,
    padding: space.md,
    borderRadius: 8,
  },
  primary: {
    minHeight: 48,
    backgroundColor: color.ruby,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: 8,
  },
  primaryText: { ...type.row, fontFamily: family(700), color: '#fff' },
  empty: { ...type.body, color: color.quiet, paddingVertical: space.lg },
  post: {
    gap: space.sm,
    paddingVertical: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.rule,
  },
  status: { ...type.sub, color: color.quiet, paddingHorizontal: space.gutter, paddingBottom: space.lg },
});
