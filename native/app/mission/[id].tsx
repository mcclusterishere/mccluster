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
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ImagePickerAsset } from 'expo-image-picker';
import Room from '../../src/Room';
import { useMcc } from '../../src/mcc';
import {
  type ActionMission,
  type MissionAssignment,
  useActionNetworkApi,
} from '../../src/actionNetwork';
import {
  chooseMissionProof,
  recoverPendingMissionProof,
  takeMissionProof,
  useProofMedia,
} from '../../src/proofMedia';
import { color, family, MIN_TOUCH, space, type } from '../../src/theme';

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export default function MissionScreen() {
  const params = useLocalSearchParams<{
    id?: string | string[];
    content?: string | string[];
    source?: string | string[];
    live?: string | string[];
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ready, session } = useMcc();
  const net = useActionNetworkApi();
  const media = useProofMedia();

  const id = one(params.id);
  const [mission, setMission] = useState<ActionMission | null>(null);
  const [assignment, setAssignment] = useState<MissionAssignment | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [proof, setProof] = useState<ImagePickerAsset | null>(null);
  const [statement, setStatement] = useState('');
  const [link, setLink] = useState('');
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    if (!ready || !session || !id) return;
    setBusy(true);
    setStatus('');
    try {
      const [nextMission, nextAssignment, record] = await Promise.all([
        net.mission(id),
        net.assignmentFor(id),
        net.actionRecord().catch(() => null),
      ]);
      setMission(nextMission);
      setAssignment(nextAssignment);
      const history = record?.record?.missions;
      const own = Array.isArray(history)
        ? history.find((row: any) => row.mission_id === id)
        : null;
      setReviewNote(String(own?.review_note || ''));
    } catch (error) {
      setStatus(messageOf(error));
    } finally {
      setBusy(false);
    }
  }, [id, net, ready, session]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let live = true;
    recoverPendingMissionProof()
      .then((asset) => {
        if (live && asset) setProof(asset);
      })
      .catch(() => null);
    return () => {
      live = false;
    };
  }, []);

  async function join() {
    if (!mission || working) return;
    setWorking(true);
    setStatus('Starting mission…');
    try {
      const result = await net.joinMission(mission.id, {
        contentId: one(params.content) || null,
        source: one(params.source) || null,
        liveSessionId: one(params.live) || null,
      });
      setAssignment({ id: result.assignment_id, status: result.status || 'joined' });
      setStatus('Mission started. Do the work, then record or choose proof.');
    } catch (error) {
      setStatus(messageOf(error));
    } finally {
      setWorking(false);
    }
  }

  async function capture(kind: 'camera' | 'library') {
    if (working) return;
    setWorking(true);
    setStatus('');
    try {
      const asset = kind === 'camera' ? await takeMissionProof() : await chooseMissionProof();
      if (asset) setProof(asset);
    } catch (error) {
      setStatus(messageOf(error));
    } finally {
      setWorking(false);
    }
  }

  async function submit() {
    if (!assignment || working) return;
    if (!proof && !link.trim() && statement.trim().length < 20) {
      setStatus('Add an upload or a link, or describe what you did in at least 20 characters.');
      return;
    }

    setWorking(true);
    setStatus(proof ? 'Uploading proof…' : 'Submitting proof…');
    try {
      let proofType = link.trim() ? 'link' : 'text';
      let metadata: Record<string, any> = {};
      if (proof) {
        const uploaded = await media.upload(proof);
        proofType = uploaded.proofType;
        metadata = { asset_id: uploaded.asset.id };
      }
      await net.submitProof({
        assignmentId: assignment.id,
        proofType,
        proofUrl: link.trim() || null,
        statement: statement.trim(),
        metadata,
        share,
      });
      setAssignment({ ...assignment, status: 'submitted' });
      setProof(null);
      setStatus(
        share
          ? 'Proof submitted. Once verified, this action can appear on the feed.'
          : 'Proof submitted for review.',
      );
    } catch (error) {
      setStatus(messageOf(error));
    } finally {
      setWorking(false);
    }
  }

  if (!ready) return <Loading label="Opening mission…" />;
  if (!session) {
    return (
      <Shell top={insets.top} onBack={() => router.back()}>
        <Text style={s.kicker}>Action Network</Text>
        <Text style={s.title}>SIGN IN TO TAKE THIS MISSION.</Text>
        <Text style={s.body}>Open Network from the bottom bar and sign in with your M Account.</Text>
      </Shell>
    );
  }

  if (busy) return <Loading label="Loading mission…" />;
  if (!mission) {
    return (
      <Shell top={insets.top} onBack={() => router.back()}>
        <Text style={s.kicker}>Action Network</Text>
        <Text style={s.title}>MISSION UNAVAILABLE.</Text>
        <Text style={s.body}>{status || 'That mission is not available any more.'}</Text>
      </Shell>
    );
  }

  const canProve =
    assignment &&
    ['joined', 'in_progress', 'submitted', 'rejected'].includes(assignment.status);
  const verified = assignment?.status === 'verified';

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
          <Pressable onPress={() => router.back()} style={s.back}>
            <Text style={s.backText}>‹ Back</Text>
          </Pressable>
        </View>

        <View style={s.hero}>
          <Text style={s.kicker}>
            {mission.domain || 'community'} · difficulty {mission.difficulty || 1}
          </Text>
          <Text style={s.title}>{mission.title}</Text>
          {mission.description ? <Text style={s.lede}>{mission.description}</Text> : null}
          <Text style={s.meta}>
            {Number(mission.base_points || 0)} base pts
            {mission.skills?.length ? ` · ${mission.skills.join(' · ')}` : ''}
          </Text>
        </View>

        <View style={s.section}>
          {!assignment ? (
            <Pressable
              disabled={working || mission.status !== 'open'}
              onPress={join}
              style={[s.primary, (working || mission.status !== 'open') && s.disabled]}
            >
              <Text style={s.primaryText}>
                {mission.status === 'open' ? (working ? 'Starting…' : 'Take this mission') : 'Mission closed'}
              </Text>
            </Pressable>
          ) : null}

          {verified ? (
            <View style={s.verified}>
              <Text style={s.kicker}>Verified action</Text>
              <Text style={s.rowTitle}>This work is on your Action Record.</Text>
            </View>
          ) : null}

          {assignment?.status === 'submitted' ? (
            <View style={s.notice}>
              <Text style={s.rowTitle}>Waiting for review</Text>
              <Text style={s.muted}>You can replace the proof until it is reviewed.</Text>
            </View>
          ) : null}

          {assignment?.status === 'rejected' ? (
            <View style={s.notice}>
              <Text style={s.rowTitle}>Proof was not verified.</Text>
              <Text style={s.muted}>
                {reviewNote || 'Fix the proof and submit it again.'}
              </Text>
            </View>
          ) : null}

          {canProve ? (
            <View style={s.proof}>
              <Text style={s.kicker}>Prove the action</Text>
              <Text style={s.sectionTitle}>Show what happened.</Text>
              <Text style={s.muted}>
                Record it now or choose an existing photo/video. Proof stays private unless the
                verified action is shared to the feed.
              </Text>

              <View style={s.captureRow}>
                <Pressable disabled={working} onPress={() => capture('camera')} style={s.capture}>
                  <Text style={s.captureText}>Open camera</Text>
                </Pressable>
                <Pressable disabled={working} onPress={() => capture('library')} style={s.capture}>
                  <Text style={s.captureText}>Choose media</Text>
                </Pressable>
              </View>

              {proof ? (
                <View style={s.previewWrap}>
                  {proof.type === 'image' ? (
                    <Image source={{ uri: proof.uri }} style={s.preview} contentFit="cover" />
                  ) : (
                    <View style={[s.preview, s.videoPreview]}>
                      <Text style={s.rowTitle}>Video selected</Text>
                      <Text style={s.meta}>{proof.fileName || 'Mission proof video'}</Text>
                    </View>
                  )}
                  <Pressable onPress={() => setProof(null)} style={s.remove}>
                    <Text style={s.removeText}>Remove</Text>
                  </Pressable>
                </View>
              ) : null}

              <Field
                label="What did you do?"
                value={statement}
                onChangeText={setStatement}
                multiline
                placeholder="Describe the action you completed"
              />
              <Field
                label="Proof link (optional)"
                value={link}
                onChangeText={setLink}
                autoCapitalize="none"
                keyboardType="url"
                placeholder="https://…"
              />

              <Pressable onPress={() => setShare((value) => !value)} style={s.shareRow}>
                <View style={[s.check, share && s.checkOn]} />
                <View style={s.flex}>
                  <Text style={s.rowTitle}>Share after verification</Text>
                  <Text style={s.meta}>
                    Verification comes first. The proof itself is not made public by this switch.
                  </Text>
                </View>
              </Pressable>

              <Pressable disabled={working} onPress={submit} style={[s.primary, working && s.disabled]}>
                <Text style={s.primaryText}>{working ? 'Working…' : 'Submit mission proof'}</Text>
              </Pressable>
            </View>
          ) : null}

          {status ? <Text style={s.status}>{status}</Text> : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <View style={s.loading}>
      <Room pulse={color.ruby} />
      <ActivityIndicator color={color.ruby} />
      <Text style={s.muted}>{label}</Text>
    </View>
  );
}

function Shell({
  top,
  onBack,
  children,
}: {
  top: number;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={s.screen}>
      <Room pulse={color.ruby} />
      <View style={[s.shell, { paddingTop: top + space.md }]}>
        <Pressable onPress={onBack} style={s.back}>
          <Text style={s.backText}>‹ Back</Text>
        </Pressable>
        {children}
      </View>
    </View>
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
  loading: {
    flex: 1,
    backgroundColor: color.stage,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  flex: { flex: 1 },
  top: { paddingHorizontal: space.gutter },
  back: {
    minHeight: MIN_TOUCH,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingRight: space.lg,
  },
  backText: { ...type.row, color: color.paper },
  shell: { flex: 1, paddingHorizontal: space.gutter, gap: space.md },
  hero: {
    paddingHorizontal: space.gutter,
    paddingTop: space.lg,
    paddingBottom: space.xl,
    gap: space.sm,
  },
  kicker: { ...type.label, color: color.ruby },
  title: { ...type.display, color: color.paper },
  lede: { ...type.body, color: color.quiet, maxWidth: 520 },
  body: { ...type.body, color: color.paper },
  muted: { ...type.body, color: color.quiet },
  meta: { ...type.sub, color: color.fainter },
  rowTitle: { ...type.row, fontFamily: family(700), color: color.paper },
  sectionTitle: { ...type.title, color: color.paper },
  section: {
    paddingHorizontal: space.gutter,
    gap: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.rule,
    paddingTop: space.xl,
  },
  primary: {
    minHeight: 52,
    backgroundColor: color.ruby,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: 8,
  },
  primaryText: { ...type.row, fontFamily: family(700), color: '#fff' },
  disabled: { opacity: 0.45 },
  verified: {
    gap: space.xs,
    paddingVertical: space.lg,
    borderLeftWidth: 2,
    borderLeftColor: color.ruby,
    paddingLeft: space.md,
  },
  notice: {
    gap: space.xs,
    padding: space.md,
    backgroundColor: color.field,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.rule,
  },
  proof: { gap: space.lg },
  captureRow: { flexDirection: 'row', gap: space.sm },
  capture: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.rule,
    backgroundColor: color.field,
    borderRadius: 8,
  },
  captureText: { ...type.row, color: color.paper, fontFamily: family(700) },
  previewWrap: { gap: space.sm },
  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: 8, backgroundColor: color.stageRaised },
  videoPreview: { alignItems: 'center', justifyContent: 'center', gap: space.xs },
  remove: { alignSelf: 'flex-start', minHeight: MIN_TOUCH, justifyContent: 'center' },
  removeText: { ...type.row, color: color.ruby },
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
  fieldMulti: { minHeight: 110, textAlignVertical: 'top' },
  shareRow: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  check: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: color.rule,
    backgroundColor: color.field,
  },
  checkOn: { backgroundColor: color.ruby, borderColor: color.ruby },
  status: { ...type.sub, color: color.quiet, paddingBottom: space.lg },
});
