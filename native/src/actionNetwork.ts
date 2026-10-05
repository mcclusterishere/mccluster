/**
 * Native Action Network data contract.
 *
 * Reads use the same Worker / RLS-visible relations as mnet.js. Every mission,
 * proof, fellowship, deletion, and share mutation stays server-authoritative
 * through the canonical RPCs.
 */
import { useMemo } from 'react';
import { ACTION_APP_KEY, useMcc } from './mcc';

export type NetworkBootstrap = {
  app?: Record<string, any>;
  surface?: Record<string, any>;
  identity?: { m_uid?: string; mccluster_id?: string | null };
  profile?: Record<string, any>;
  onboarding?: Record<string, any>;
  next_step?: 'feed' | 'profile' | string;
  feed?: Record<string, any>;
};

export type FeedItem = {
  item_type?: string;
  post_id?: string;
  occurred_at?: string;
  payload?: Record<string, any>;
  actor?: Record<string, any>;
  post?: Record<string, any>;
  action?: Record<string, any> | null;
  offer?: Record<string, any> | null;
};

export type FeedPage = {
  items: FeedItem[];
  next_before?: string | null;
};

export type ActionMission = {
  id: string;
  campaign_id?: string | null;
  title: string;
  description?: string | null;
  domain?: string | null;
  difficulty?: number | null;
  base_points?: number | null;
  proof_required?: boolean | null;
  verification_mode?: string | null;
  skills?: string[] | null;
  capacity?: number | null;
  status?: string;
  starts_at?: string | null;
  ends_at?: string | null;
};

export type MissionAssignment = {
  id: string;
  status: string;
  mission_id?: string;
  user_id?: string;
  [key: string]: any;
};

export type NetworkGroup = {
  id: string;
  slug: string;
  name: string;
  purpose?: string | null;
  visibility?: 'open' | 'request' | 'invite' | string;
  member_count?: number;
  organization_id?: string | null;
  group_type?: string | null;
  front_page_url?: string | null;
  joined?: boolean;
  requested?: boolean;
};

const MISSION_FIELDS =
  'id,campaign_id,title,description,domain,difficulty,base_points,proof_required,verification_mode,skills,capacity,status,starts_at,ends_at';

export function useActionNetworkApi() {
  const { api, rest, rpc, user } = useMcc();

  return useMemo(() => {
    async function bootstrap() {
      return api<NetworkBootstrap>(
        `/v1/mnet/bootstrap?app_key=${encodeURIComponent(ACTION_APP_KEY)}`,
      );
    }

    async function feed(before?: string | null, limit = 25): Promise<FeedPage> {
      const q = new URLSearchParams({
        app_key: ACTION_APP_KEY,
        limit: String(Math.max(1, Math.min(100, limit))),
      });
      if (before) q.set('before', before);
      const page = await api<FeedPage>(`/v1/mnet/feed?${q.toString()}`);
      const items = Array.isArray(page.items) ? page.items : [];
      const actionIds: string[] = [];
      const offerIds: string[] = [];
      for (const item of items) {
        const post = item.post;
        if (!post?.id) continue;
        if (post.post_type === 'share' && post.metadata?.action) actionIds.push(post.id);
        if (post.content_id) offerIds.push(post.id);
      }
      const [actions, offers] = await Promise.all([
        actionIds.length
          ? rpc<any[]>('action_feed_cards', { p_post_ids: actionIds.slice(0, 100) }).catch(() => [])
          : Promise.resolve([]),
        offerIds.length
          ? rpc<any[]>('action_offer_cards', { p_post_ids: offerIds.slice(0, 100) }).catch(() => [])
          : Promise.resolve([]),
      ]);
      const actionMap = new Map((actions || []).map((row) => [row.post_id, row]));
      const offerMap = new Map((offers || []).map((row) => [row.post_id, row]));
      return {
        ...page,
        items: items.map((item) => ({
          ...item,
          action: actionMap.get(item.post?.id) || null,
          offer: offerMap.get(item.post?.id) || null,
        })),
      };
    }

    async function groups(): Promise<NetworkGroup[]> {
      const out = await api<{ groups?: NetworkGroup[] }>('/v1/mnet/groups');
      return out.groups || [];
    }

    async function group(slug: string) {
      return api<{
        group: NetworkGroup;
        organization?: Record<string, any> | null;
        campaigns?: Record<string, any>[];
        items?: FeedItem[];
      }>(`/v1/mnet/groups/${encodeURIComponent(slug)}`);
    }

    async function setGroupMembership(slug: string, joined: boolean) {
      return api<{ joined: boolean; requested?: boolean }>(
        `/v1/mnet/groups/${encodeURIComponent(slug)}/membership`,
        { method: joined ? 'POST' : 'DELETE' },
      );
    }

    async function missions(campaign?: string | null): Promise<ActionMission[]> {
      const campaignFilter = campaign ? `&campaign_id=eq.${encodeURIComponent(campaign)}` : '';
      return rest<ActionMission[]>(
        `action_missions?status=eq.open${campaignFilter}&select=${MISSION_FIELDS}&order=created_at.desc`,
      );
    }

    async function mission(id: string): Promise<ActionMission | null> {
      const rows = await rest<ActionMission[]>(
        `action_missions?id=eq.${encodeURIComponent(id)}&select=${MISSION_FIELDS}&limit=1`,
      );
      return rows?.[0] || null;
    }

    async function missionStats(campaign?: string | null) {
      return rpc<any[]>('action_mission_stats', { p_campaign: campaign || null });
    }

    async function assignmentFor(missionId: string): Promise<MissionAssignment | null> {
      if (!user?.id) return null;
      const rows = await rest<MissionAssignment[]>(
        'action_mission_assignments?mission_id=eq.' +
          encodeURIComponent(missionId) +
          '&user_id=eq.' +
          encodeURIComponent(user.id) +
          '&select=id,status,mission_id,user_id&limit=1',
      );
      return rows?.[0] || null;
    }

    async function joinMission(
      missionId: string,
      source?: { contentId?: string | null; source?: string | null; liveSessionId?: string | null },
    ) {
      if (source?.liveSessionId) {
        return rpc<{ assignment_id: string; status: string }>('join_action_mission_live', {
          p_mission_id: missionId,
          p_live_session_id: source.liveSessionId,
        });
      }
      if (source?.contentId) {
        return rpc<{ assignment_id: string; status: string }>('join_action_mission_attributed', {
          p_mission_id: missionId,
          p_content_id: source.contentId,
          p_source: source.source || 'network',
        });
      }
      return rpc<{ assignment_id: string; status: string }>('join_action_mission', {
        p_mission_id: missionId,
      });
    }

    async function submitProof(input: {
      assignmentId: string;
      proofType: 'video' | 'photo' | 'link' | 'text' | string;
      proofUrl?: string | null;
      statement: string;
      metadata?: Record<string, any>;
      share?: boolean;
    }) {
      // Privacy preference is a precondition, not best effort. A stale
      // share=true intent from an earlier submission must never survive when
      // the member now chooses private proof.
      await rpc('set_action_share_intent', {
        p_assignment_id: input.assignmentId,
        p_share: input.share !== false,
      });
      return rpc('submit_action_proof', {
        p_assignment_id: input.assignmentId,
        p_proof_type: input.proofType,
        p_proof_url: input.proofUrl || null,
        p_statement: input.statement,
        p_metadata: input.metadata || {},
      });
    }

    async function actionRecord() {
      const [record, fellowship, shares] = await Promise.all([
        rpc<any>('action_record').catch(() => null),
        rpc<any>('action_fellowship_status').catch(() => null),
        rpc<any[]>('my_action_shares').catch(() => []),
      ]);
      return { record, fellowship, shares: shares || [] };
    }

    async function markTourSeen() {
      return rpc<any>('mnet_mark_tour_seen', { p_app_key: ACTION_APP_KEY });
    }

    async function deletion() {
      return rpc<any>('my_account_deletion').catch(() => ({}));
    }

    async function requestDeletion(reason?: string) {
      return rpc<any>('request_account_deletion', { p_reason: reason?.trim() || null });
    }

    async function cancelDeletion() {
      return rpc<any>('cancel_account_deletion');
    }

    async function updateProfile(input: {
      mccluster_id?: string;
      display_name?: string;
      headline?: string;
      bio?: string;
      avatar_url?: string;
      banner_url?: string;
      website_url?: string;
    }) {
      return api<any>(
        `/v1/mnet/profile?app_key=${encodeURIComponent(ACTION_APP_KEY)}`,
        { method: 'PATCH', body: input },
      );
    }

    async function notifications() {
      const out = await api<{ notifications?: any[] }>('/v1/mnet/notifications');
      return out.notifications || [];
    }

    async function markNotificationsRead() {
      return api('/v1/mnet/notifications/read', { method: 'POST', body: {} });
    }

    async function createPost(body: string, groupId?: string | null) {
      return api<any>(
        `/v1/mnet/posts?app_key=${encodeURIComponent(ACTION_APP_KEY)}`,
        { method: 'POST', body: { body, group_id: groupId || null } },
      );
    }

    return {
      bootstrap,
      feed,
      groups,
      group,
      setGroupMembership,
      missions,
      mission,
      missionStats,
      assignmentFor,
      joinMission,
      submitProof,
      actionRecord,
      markTourSeen,
      deletion,
      requestDeletion,
      cancelDeletion,
      updateProfile,
      notifications,
      markNotificationsRead,
      createPost,
    };
  }, [api, rest, rpc, user?.id]);
}
