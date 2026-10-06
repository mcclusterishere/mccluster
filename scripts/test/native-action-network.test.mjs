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
