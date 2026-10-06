import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (path) => fs.readFile(new URL('../../' + path, import.meta.url), 'utf8');

test('Network tab is native, not a web hand-off', async () => {
  const profile = await read('native/app/(tabs)/profile.tsx');
  assert.match(profile, /ActionNetworkScreen/);
  assert.doesNotMatch(profile, /RoomScreen/);
  assert.doesNotMatch(profile, /mnet\.html/);
});

test('native M Account persists only the Supabase session in SecureStore', async () => {
  const auth = await read('native/src/mcc.tsx');
  assert.match(auth, /expo-secure-store/);
  assert.match(auth, /mcc\.session\.v1/);
  assert.match(auth, /token\?grant_type=refresh_token/);
  assert.match(auth, /ACTION_APP_KEY = 'mccluster-web'/);
  assert.match(auth, /https:\/\/api\.mccluster\.org/);
  assert.doesNotMatch(auth, /service_role/i);
});

test('mission writes stay behind server-authoritative RPCs', async () => {
  const client = await read('native/src/actionNetwork.ts');
  assert.match(client, /rpc<.*>\('join_action_mission'/s);
  assert.match(client, /rpc\('submit_action_proof'/);
  assert.match(client, /rpc\('set_action_share_intent'/);
  const shareIntent = client.indexOf("rpc('set_action_share_intent'");
  const proofSubmit = client.indexOf("rpc('submit_action_proof'");
  assert.ok(shareIntent >= 0 && proofSubmit > shareIntent, 'share preference must be saved before proof submission');
  assert.doesNotMatch(
    client.slice(shareIntent, proofSubmit),
    /catch\(\(\) => null\)/,
    'share preference failure must block proof submission',
  );
  assert.match(client, /rpc<any>\('action_record'/);
  assert.doesNotMatch(client, /action_mission_assignments[^\n]+method:\s*['"](?:POST|PATCH|DELETE)/);
  assert.doesNotMatch(client, /action_proofs[^\n]+method:\s*['"](?:POST|PATCH|DELETE)/);
});

test('native proof capture uses private signed media flow with iOS video permission', async () => {
  const [media, app, pkg] = await Promise.all([
    read('native/src/proofMedia.ts'),
    read('native/app.json'),
    read('native/package.json'),
  ]);
  assert.match(media, /expo-image-picker/);
  assert.match(media, /\/v1\/mnet\/media\/upload-url/);
  assert.match(media, /\/v1\/mnet\/media\/finalize/);
  assert.match(media, /ImageManipulator\.manipulateAsync/);
  assert.match(media, /image\/jpeg/);
  assert.ok(
    media.indexOf('ImageManipulator.manipulateAsync') < media.indexOf("/v1/mnet/media/upload-url"),
    'HEIC conversion must happen before the upload slot is requested',
  );
  assert.match(media, /mnet-media/);
  const appJson = JSON.parse(app);
  const picker = appJson.expo.plugins.find((entry) => Array.isArray(entry) && entry[0] === 'expo-image-picker');
  assert.ok(picker, 'expo-image-picker config plugin must be present');
  assert.match(picker[1].microphonePermission, /microphone.*video mission proof/i);
  const packageJson = JSON.parse(pkg);
  assert.match(packageJson.dependencies['expo-image-picker'], /^~57\./);
  assert.match(packageJson.dependencies['expo-image-manipulator'], /^~57\./);
  assert.match(packageJson.dependencies['expo-secure-store'], /^~57\./);
});

test('mission and group routes are deep-linkable native work surfaces', async () => {
  const [mission, group, app, intent] = await Promise.all([
    read('native/app/mission/[id].tsx'),
    read('native/app/group/[slug].tsx'),
    read('native/app.json'),
    read('native/app/+native-intent.tsx'),
  ]);
  assert.match(mission, /takeMissionProof/);
  assert.match(mission, /recoverPendingMissionProof/);
  assert.match(mission, /at least 20 characters/);
  assert.match(mission, /joinMission/);
  assert.match(mission, /submitProof/);
  assert.match(group, /setGroupMembership/);
  assert.match(group, /createPost/);
  assert.ok(
    group.indexOf('if (!session)') < group.lastIndexOf('if (busy)'),
    'signed-out group routes must show sign-in before the loading gate',
  );
  const config = JSON.parse(app).expo;
  assert.equal(config.scheme, 'here');
  assert.ok(config.ios.associatedDomains.includes('applinks:matthew.mccluster.org'));
  assert.ok(
    config.android.intentFilters.some(
      (filter) =>
        filter.action === 'VIEW' &&
        filter.autoVerify === true &&
        filter.data?.some(
          (data) =>
            data.scheme === 'https' &&
            data.host === 'matthew.mccluster.org' &&
            data.pathPrefix === '/mnet.html',
        ),
    ),
    'Android app link declaration must cover shared Action Network mission URLs',
  );
  assert.match(intent, /matthew\.mccluster\.org/);
  assert.match(intent, /searchParams\.get\('mission'\)/);
  assert.match(intent, /return `\/mission\/\$\{mission\}`/);
});

test('first-run walkthrough is shared with the web account state', async () => {
  const [screen, client] = await Promise.all([
    read('native/src/ActionNetworkScreen.tsx'),
    read('native/src/actionNetwork.ts'),
  ]);
  assert.match(screen, /tour_done_at/);
  assert.match(screen, /Take the tour/);
  assert.match(screen, /Welcome to the Action Network/);
  assert.match(client, /mnet_mark_tour_seen/);
  assert.match(client, /p_app_key: ACTION_APP_KEY/);
});

test('account deletion can be started and cancelled inside the native app', async () => {
  const [screen, client] = await Promise.all([
    read('native/src/ActionNetworkScreen.tsx'),
    read('native/src/actionNetwork.ts'),
  ]);
  assert.match(screen, /Request account deletion/);
  assert.match(screen, /Cancel deletion/);
  assert.match(client, /request_account_deletion/);
  assert.match(client, /cancel_account_deletion/);
});

test('root owns one auth provider across all routes', async () => {
  const root = await read('native/app/_layout.tsx');
  assert.match(root, /<MccProvider>/);
  assert.match(root, /name="mission\/\[id\]"/);
  assert.match(root, /name="group\/\[slug\]"/);
});

test('a failed proof submission discards only an upload nothing references', async () => {
  const mission = await read('native/app/mission/[id].tsx');
  const submit = mission.slice(mission.indexOf('async function submit()'), mission.indexOf('if (!ready) return'));
  const declared = submit.indexOf('let uploadedAssetId');
  assert.ok(declared > -1 && declared < submit.indexOf('try {'), 'the upload id is declared outside try so catch can read it');
  const submitted = submit.indexOf('await net.submitProof(');
  const cleared = submit.indexOf('uploadedAssetId = null;', submitted);
  assert.ok(submitted > -1 && cleared > submitted, 'once the proof is submitted it references the upload, which must never be discarded');
  assert.match(submit, /if \(uploadedAssetId && typeof \(error as any\)\?\.status === 'number'\) \{\s*await media\.discard\(uploadedAssetId\)/,
    'discard only when the server answered with a failure; a dropped connection may have committed the proof');
});

test('the keychain holds only tokens, expiry and the member’s id and email', async () => {
  const { persistableSession } = await import('../../native/src/sessionPolicy.ts');
  const token = 'h.' + 'x'.repeat(1150) + '.s';
  const gotrue = {
    access_token: token, refresh_token: 'r8x2kq', expires_in: 3600, token_type: 'bearer',
    user: {
      id: '723e4567-e89b-42d3-a456-426614174777', email: 'jane@example.com',
      user_metadata: { name: 'Jane Doe', full_name: 'Jane Doe', avatar_url: 'https://example.com/' + 'a'.repeat(200) },
      app_metadata: { provider: 'email', providers: ['email', 'google'] },
      identities: Array.from({ length: 2 }, (_, i) => ({
        identity_id: 'x'.repeat(36), id: 'y'.repeat(36), user_id: '723e4567-e89b-42d3-a456-426614174777', provider: i ? 'google' : 'email',
        identity_data: { email: 'jane@example.com', email_verified: true, phone_verified: false, sub: 'z'.repeat(36), name: 'Jane Doe', picture: 'https://example.com/' + 'p'.repeat(120) },
        last_sign_in_at: '2026-10-06T00:00:00Z', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-10-06T00:00:00Z'
      }))
    }
  };
  assert.ok(JSON.stringify(gotrue).length > 2048, 'a real session with its user is over the old iOS keychain limit');
  const stored = persistableSession(gotrue);
  assert.deepEqual(Object.keys(stored).sort(), ['access_token', 'expires_at', 'refresh_token', 'token_type', 'user']);
  assert.deepEqual(stored.user, { id: '723e4567-e89b-42d3-a456-426614174777', email: 'jane@example.com' });
  assert.ok(JSON.stringify(stored).length < 2048, 'what is stored stays under it');
  assert.ok(stored.expires_at > Date.now() / 1000 + 3500, 'expiry is derived from expires_in');
  assert.equal(persistableSession({ access_token: token }), null, 'no refresh token, nothing worth keeping');
  assert.equal(persistableSession(null), null);
});

test('only a definitive auth answer ends the session; offline and server errors keep it', async () => {
  const { isDefinitiveAuthFailure, isFresh } = await import('../../native/src/sessionPolicy.ts');
  for (const status of [400, 401, 403, 404]) assert.equal(isDefinitiveAuthFailure({ status }), true, String(status));
  for (const error of [new TypeError('Network request failed'), { status: 500 }, { status: 503 }, { status: 429 }, {}, null]) {
    assert.equal(isDefinitiveAuthFailure(error), false, JSON.stringify(error));
  }
  const now = 1_800_000_000;
  assert.equal(isFresh({ expires_at: now + 61 }, now), true);
  assert.equal(isFresh({ expires_at: now + 60 }, now), false, 'within a minute of expiry counts as expired');
  assert.equal(isFresh(null, now), false);
});

test('concurrent refreshes share one call, so a single-use refresh token is spent once', async () => {
  const { singleFlight } = await import('../../native/src/sessionPolicy.ts');
  let calls = 0, release;
  const refresh = singleFlight(() => { calls++; return new Promise((resolve) => { release = resolve; }); });
  const a = refresh(), b = refresh(), c = refresh();
  release('session-2');
  assert.deepEqual(await Promise.all([a, b, c]), ['session-2', 'session-2', 'session-2']);
  assert.equal(calls, 1);
  const failing = singleFlight(() => { calls++; return Promise.reject(Object.assign(new Error('offline'), {})); });
  await assert.rejects(Promise.all([failing(), failing()]), /offline/);
  assert.equal(calls, 2, 'a failure is shared too');
  await assert.rejects(failing(), /offline/);
  assert.equal(calls, 3, 'once settled, the next call refreshes again');
});

test('the M Account provider applies those rules', async () => {
  const auth = await read('native/src/mcc.tsx');
  assert.match(auth, /from '\.\/sessionPolicy'/);
  assert.match(auth, /const stored = persistableSession\(session\);\s*if \(stored\) \{\s*await SecureStore\.setItemAsync\(SESSION_KEY, JSON\.stringify\(stored\)/, 'the keychain gets the slim session');
  assert.match(auth, /const refresh = useMemo\(\s*\(\) =>\s*singleFlight\(/, 'refresh is single-flight');
  const refresh = auth.slice(auth.indexOf('const refresh = useMemo('), auth.indexOf('const freshSession'));
  assert.match(refresh, /if \(!isDefinitiveAuthFailure\(error\)\) throw error;/, 'a transient refresh failure is reported, not turned into a sign-out');
  const boot = auth.slice(auth.indexOf('let restored = await storedSession();'), auth.indexOf('if (alive) setReady(true);'));
  assert.match(boot, /if \(restored\) \{\s*setSession\(restored\);/, 'a stored session signs the member in immediately, offline included');
  assert.match(boot, /if \(alive && isDefinitiveAuthFailure\(error\)\) \{\s*await commitSession\(null\);/, 'launch only ends the session on a definitive answer');
  assert.doesNotMatch(boot, /\} catch \{\s*if \(alive\) \{\s*await commitSession\(null\)/, 'no blanket sign-out on launch');
});
