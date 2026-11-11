import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

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
  assert.match(screen, /Welcome to Equity Uprise/);
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
  /* Supabase Auth sends both expires_in and expires_at, and its expires_at is a
     time on the server's clock: here an hour behind this phone's. */
  const phone = 1_800_003_600, server = phone - 3600;
  const gotrue = {
    access_token: token, refresh_token: 'r8x2kq', expires_in: 3600, expires_at: server + 3600, token_type: 'bearer',
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
  const stored = persistableSession(gotrue, phone);
  assert.deepEqual(Object.keys(stored).sort(), ['access_token', 'expires_at', 'refresh_token', 'server_expires_at', 'token_type', 'user']);
  assert.deepEqual(stored.user, { id: '723e4567-e89b-42d3-a456-426614174777', email: 'jane@example.com' });
  assert.ok(JSON.stringify(stored).length < 2048, 'what is stored stays under it');
  assert.equal(stored.expires_at, phone + 3600, 'expiry is expires_in from when the answer arrived, on this phone’s clock');
  assert.equal(stored.server_expires_at, server + 3600, 'the server’s own expires_at is kept beside it, on the server’s clock');
  const now = Date.now() / 1000;
  assert.ok(Math.abs(persistableSession(gotrue).expires_at - (now + 3600)) <= 1, 'by default, now is the phone’s clock');
  assert.equal(persistableSession({ access_token: token }), null, 'no refresh token, nothing worth keeping');
  assert.equal(persistableSession(null), null);
});

test('an answer’s expiry is measured on the phone’s clock as it arrives, and never again', async () => {
  const { stampExpiry, persistableSession, restoredSession, isFresh } = await import('../../native/src/sessionPolicy.ts');
  const server = 1_800_000_000; /* the auth server's clock as it answers */
  const answer = { access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: server + 3600 };
  for (const [phone, skew] of [['an hour ahead', 3600], ['an hour behind', -3600], ['on time', 0]]) {
    const now = server + skew;
    const stamped = stampExpiry(answer, now);
    assert.deepEqual(stamped, {
      access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_at: now + 3600, server_expires_at: server + 3600,
    }, `${phone}: expires_in counted from this moment, so it is spent`);
    assert.equal(isFresh(stamped, now), true, `${phone}: fresh as it arrives`);
    assert.equal(isFresh(stamped, now + 3600 - 61), true, phone);
    assert.equal(isFresh(stamped, now + 3600 - 60), false, `${phone}: stale a minute before the server expires it`);
    for (const later of [now, now + 3600, now + 7 * 86_400]) {
      assert.deepEqual(stampExpiry(stamped, later), stamped, `${phone}: stamping it again, at any time, changes nothing`);
      const stored = persistableSession(stamped, later);
      assert.deepEqual([stored.expires_at, stored.server_expires_at], [now + 3600, server + 3600], `${phone}: nor does the keychain write`);
      assert.equal(restoredSession(JSON.parse(JSON.stringify(stored))).expires_at, now + 3600, `${phone}: nor reading it back`);
    }
  }
  assert.deepEqual(answer, { access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: server + 3600 },
    'the answer passed in is not changed');
  /* the fallbacks, as before */
  assert.deepEqual(stampExpiry({ expires_at: server + 3600 }, server + 7200), { expires_at: server + 3600 }, 'no expires_in: a server expires_at is kept as it was');
  assert.deepEqual(stampExpiry({ expires_in: 900 }, server), { expires_at: server + 900 }, 'no expires_at: expires_in from now');
  assert.deepEqual(stampExpiry({}, server), { expires_at: server + 3600 }, 'neither: an hour');
  for (const life of [0, -5, 'soon', null]) {
    assert.deepEqual(stampExpiry({ expires_in: life, expires_at: server + 60 }, server), { expires_at: server + 60 }, `expires_in ${life} is no lifetime`);
  }
  assert.equal(stampExpiry({ expires_in: 3600 }, server + 0.75).expires_at, server + 3600, 'whole seconds');
  /* a stored session is read as stored: one without an expiry is stale, not given a new hour */
  const kept = { access_token: 'a', refresh_token: 'r', expires_at: server + 3600, server_expires_at: server };
  assert.equal(restoredSession(kept), kept);
  assert.equal(isFresh(restoredSession({ access_token: 'a', refresh_token: 'r' }), server), false);
  for (const nothing of [null, undefined, {}, { refresh_token: 'r' }]) assert.equal(restoredSession(nothing), null);
  /* one an earlier build stored, with the server's expires_at alone, reads as stale until refreshed */
  const earlier = { access_token: 'a', refresh_token: 'r', expires_at: server + 3600, token_type: 'bearer' };
  assert.equal(isFresh(restoredSession(earlier), server), false, 'its expiry is on a clock this phone cannot read');
  assert.deepEqual(earlier, { access_token: 'a', refresh_token: 'r', expires_at: server + 3600, token_type: 'bearer' }, 'what was read is not changed');
});

test('only a definitive auth answer ends the session; offline and server errors keep it', async () => {
  const { isDefinitiveAuthFailure, isFresh, sessionChangedError } = await import('../../native/src/sessionPolicy.ts');
  for (const status of [400, 401, 403, 404, 422]) assert.equal(isDefinitiveAuthFailure({ status }), true, String(status));
  for (const error of [new TypeError('Network request failed'), { status: 500 }, { status: 503 }, { status: 429 }, {}, null]) {
    assert.equal(isDefinitiveAuthFailure(error), false, JSON.stringify(error));
  }
  /* Supabase Auth names the condition; its status for one condition varies */
  for (const code of ['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'session_expired', 'user_not_found', 'bad_jwt']) {
    assert.equal(isDefinitiveAuthFailure({ status: 409, data: { code: 409, error_code: code, msg: 'x' } }), true, code);
  }
  assert.equal(isDefinitiveAuthFailure({ status: 418, data: { error: 'invalid_grant' } }), true, 'older servers put the code in `error`');
  assert.equal(isDefinitiveAuthFailure({ status: 429, data: { code: 429, error_code: 'over_request_rate_limit' } }), false, 'rate limited is not dead');
  assert.equal(isDefinitiveAuthFailure({ status: 504, data: { error_code: 'request_timeout' } }), false);
  /* a request cancelled because the account changed never reached the server */
  const changed = sessionChangedError();
  assert.equal(changed.code, 'session_changed');
  assert.equal(changed.status, undefined, 'no status, so it never triggers a sign-out or a proof-upload discard');
  assert.equal(isDefinitiveAuthFailure(changed), false);
  const now = 1_800_000_000;
  assert.equal(isFresh({ expires_at: now + 61 }, now), true);
  assert.equal(isFresh({ expires_at: now + 60 }, now), false, 'within a minute of expiry counts as expired');
  assert.equal(isFresh(null, now), false);
});

test('an answer that refuses only the access token is told apart from one that says the session is gone', async () => {
  const { isAccessTokenRefusal, isDefinitiveAuthFailure, sessionChangedError } = await import('../../native/src/sessionPolicy.ts');
  /* Supabase Auth's answer to an expired token, and to a request without one */
  const expired = { status: 403, data: { code: 403, error_code: 'bad_jwt', msg: 'invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired' } };
  assert.equal(isAccessTokenRefusal(expired), true);
  assert.equal(isAccessTokenRefusal({ status: 401, data: { code: 401, error_code: 'no_authorization' } }), true);
  assert.equal(isAccessTokenRefusal({ status: 400, data: { code: 400, error_code: 'bad_jwt' } }), true, 'bad_jwt whatever the status');
  for (const status of [401, 403]) assert.equal(isAccessTokenRefusal({ status }), true, `a ${status} that names no session code`);
  /* answers that name the session, or the member, as gone: a refresh cannot help */
  for (const code of ['session_not_found', 'refresh_token_not_found', 'refresh_token_already_used', 'session_expired', 'user_not_found', 'user_banned']) {
    const gone = { status: 403, data: { code: 403, error_code: code } };
    assert.equal(isAccessTokenRefusal(gone), false, code);
    assert.equal(isDefinitiveAuthFailure(gone), true, code);
  }
  assert.equal(isAccessTokenRefusal({ status: 401, data: { error: 'invalid_grant' } }), false, 'older servers put the code in `error`');
  /* answers that say nothing about the token */
  for (const error of [new TypeError('Network request failed'), { status: 500 }, { status: 503 }, { status: 429 }, { status: 400 }, { status: 404 }, { status: 422 }, {}, null, sessionChangedError()]) {
    assert.equal(isAccessTokenRefusal(error), false, String(error?.status ?? error?.message ?? error));
  }
  /* unchanged: a refused token is still a definitive answer, so a refresh refused with one still signs out */
  assert.equal(isDefinitiveAuthFailure(expired), true);
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
  const code = auth.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /Date\.now\(|expires_at\s*=[^=]/, 'the provider neither reads the clock nor sets an expiry: sessionPolicy stampExpiry does');
  assert.equal(code.match(/stampExpiry\(/g)?.length, 1, 'stamped in one place, as each answer arrives (sessionFromAnswer)');
  assert.equal(code.match(/restoredSession<MccSession>\(/g)?.length, 2, 'the keychain (and the web build’s localStorage) is read as stored');
  const refresh = auth.slice(auth.indexOf('const refresh = useMemo('), auth.indexOf('const freshSession'));
  assert.match(refresh, /if \(!isDefinitiveAuthFailure\(error\)\) throw error;/, 'a transient refresh failure is reported, not turned into a sign-out');
  assert.doesNotMatch(refresh, /return sessionRef\.current/, 'a request waiting on a refresh never continues under a session it did not start with');
  assert.match(refresh, /if \(sessionRef\.current !== current\) throw sessionChangedError\(\);/);
  const boot = auth.slice(auth.indexOf('let restored = await storedSession();'), auth.indexOf('if (alive) setReady(true);'));
  assert.match(boot, /if \(restored\) \{\s*setSession\(restored\);/, 'a stored session signs the member in immediately, offline included');
  assert.match(boot, /if \(!isAccessTokenRefusal\(error\)\) \{\s*if \(alive && isDefinitiveAuthFailure\(error\)\) await endSession\(restored\);/,
    'launch ends the session only on a definitive answer about it, not about its token');
  assert.match(boot, /renewed = await refresh\(\);\s*if \(renewed\) await readAccount\(renewed\);/, 'a token Auth refuses is refreshed once and the account read again');
  assert.doesNotMatch(boot, /\} catch \{\s*if \(alive\) \{\s*await commitSession\(null\)/, 'no blanket sign-out on launch');
  assert.match(auth, /const endSession = useCallback\(\s*async \(refused: MccSession\) => \{\s*if \(sessionRef\.current !== refused\) return;/,
    'only the session Auth answered for is ended, never one that replaced it');
  const authorized = auth.slice(auth.indexOf('const authorized = useCallback('), auth.indexOf('const api = useCallback('));
  assert.match(authorized, /const used = await freshSession\(\);\s*const response = await send\(used\.access_token\);\s*if \(response\.status !== 401\) return responseJson<T>\(response\);/,
    'only a server’s 401 is put to Auth, never the one thrown here before anything is sent');
  assert.equal(authorized.match(/await send\(/g)?.length, 2, 'a request is sent once, and once more at most');
  assert.equal(code.match(/authorized<T>\(/g)?.length, 2, 'api() and rest() (and so rpc()) both go through it');
});

/* ---- The provider itself, on a phone whose clock is not the server's ------

   native/src/mcc.tsx and sessionPolicy.ts as they ship: types stripped, the
   provider's one JSX element written as React.createElement, imports and
   exports turned into a function scope, run in a vm context whose Date is the
   phone's clock. React renders the provider once: every function it hands out
   reads refs, not render state, so one render is enough to drive it. The
   keychain is a Map. Supabase Auth and the McCluster API are a fixture that
   keeps the server's clock. No account, no network. */

const SESSION_KEY = 'mcc.session.v1';
let nativeScripts = null;

function asScript(js, file) {
  const exported = [];
  const body = js
    .replace(/^import\s+([\s\S]*?)\s+from\s+'([^']+)';/gm, (_, clause, spec) => {
      const from = `__import(${JSON.stringify(spec)})`;
      const namespace = /^\*\s+as\s+(\w+)$/.exec(clause.trim());
      if (namespace) return `const ${namespace[1]} = ${from};`;
      const named = /^(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?$/.exec(clause.trim());
      assert.ok(named, `${file}: teach this fixture the import ${clause}`);
      return [named[1] && `const ${named[1]} = ${from}.default;`, named[2] && `const {${named[2]}} = ${from};`].filter(Boolean).join(' ');
    })
    .replace(/^export (async function|function|const|let) (\w+)/gm, (_, kind, name) => {
      exported.push(name);
      return `${kind} ${name}`;
    });
  return `(() => {'use strict';\n${body}\nreturn { ${exported.join(', ')} };\n})()`;
}

function nativeSources() {
  nativeScripts ||= (async () => {
    const [policy, provider] = await Promise.all([read('native/src/sessionPolicy.ts'), read('native/src/mcc.tsx')]);
    const element = 'return <MccContext.Provider value={value}>{children}</MccContext.Provider>;';
    assert.equal(provider.split(element).length, 2, 'mcc.tsx renders one context element; teach this fixture any other JSX');
    const tsx = provider.replace(element, 'return React.createElement(MccContext.Provider, { value }, children);');
    return {
      policy: asScript(stripTypeScriptTypes(policy, { mode: 'strip' }), 'sessionPolicy.ts'),
      provider: asScript(stripTypeScriptTypes(tsx, { mode: 'strip' }), 'mcc.tsx'),
    };
  })();
  return nativeScripts;
}

/* Supabase Auth and the McCluster API, on the server's clock. A token expires
   `lifetime` seconds after it is issued; once it has, Auth refuses it as
   Supabase does (403 bad_jwt) and the API answers 401. Refresh tokens are
   single-use. endSessions() ends every session as a sign-out everywhere does:
   its refresh tokens are gone, and a token still within its lifetime is
   refused as Supabase does (403 session_not_found). Auth checks the token
   first, so an expired one still reads bad_jwt. A route in `outage` is
   unreachable ('offline': fetch rejects, as on a phone without signal) or
   answers that HTTP status.

   The API is the Worker as it is: its gate asks Auth for the user and answers
   any refusal, and Auth being down, with the same 401 (authUser in
   workers/mccluster/src/platform-api.js). PostgREST checks the token itself,
   statelessly, and refuses an expired one before any SQL runs (401
   PGRST303). Each request records its method, path and the status it got.

   Tokens belong to the member they were issued to: Jane, or whoever signs in.
   hold(path) keeps the next request to that path in flight until the
   function it returns is called; the server sees it then. */
function authServer({ lifetime = 3600 } = {}) {
  const clock = { now: 1_800_000_000 };
  const expiry = new Map(), unspent = new Set(), ended = new Set(), requests = [], outage = new Map(), holds = new Map();
  const people = new Map([
    ['jane@example.com', { id: '723e4567-e89b-42d3-a456-426614174777', email: 'jane@example.com' }],
    ['sam@example.com', { id: '5f0c2b1e-8d3a-4c6e-9b7a-1e2d3c4b5a69', email: 'sam@example.com' }],
  ]);
  const holder = new Map(); /* access or refresh token -> the member it was issued to */
  let issued = 0;
  const issue = (user = people.get('jane@example.com')) => {
    issued += 1;
    const session = {
      access_token: `access-${issued}`, token_type: 'bearer', expires_in: lifetime,
      expires_at: clock.now + lifetime, refresh_token: `refresh-${issued}`, user,
    };
    expiry.set(session.access_token, session.expires_at);
    unspent.add(session.refresh_token);
    holder.set(session.access_token, user).set(session.refresh_token, user);
    return session;
  };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  async function fetch(url, init = {}) {
    const { host, pathname, searchParams } = new URL(String(url));
    const held = holds.get(pathname);
    if (held) {
      holds.delete(pathname);
      await held;
    }
    const grant = searchParams.get('grant_type');
    const route = host === 'api.mccluster.org' ? 'api'
      : pathname.startsWith('/rest/v1/') ? 'rest'
        : pathname.replace('/auth/v1/', '') + (grant ? `:${grant}` : '');
    const token = String(init.headers?.authorization || '').replace(/^Bearer /, '') || null;
    const expired = !!token && !(expiry.get(token) > clock.now);
    const request = { route, token, expired, at: clock.now, method: init.method || 'GET', path: pathname };
    requests.push(request);
    const response = answer(request, init);
    request.status = response.status;
    return response;
  }
  function answer({ route, token, expired }, init) {
    const down = outage.get(route);
    if (down === 'offline') throw new TypeError('Network request failed');
    if (down) return reply(down, { message: down >= 500 ? 'upstream unavailable' : 'refused' });
    switch (route) {
      case 'token:password':
      case 'signup':
        return reply(200, issue(people.get(JSON.parse(init.body).email)));
      case 'token:refresh_token': {
        const spent = JSON.parse(init.body).refresh_token;
        return unspent.delete(spent)
          ? reply(200, issue(holder.get(spent)))
          : reply(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
      }
      case 'logout':
        return new Response(null, { status: 204 });
      case 'user':
        if (expired) return reply(403, { code: 403, error_code: 'bad_jwt', msg: 'invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired' });
        if (ended.has(token)) return reply(403, { code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' });
        return reply(200, holder.get(token));
      case 'api':
        return expired || ended.has(token) || outage.has('user')
          ? reply(401, { error: 'Authentication required' })
          : reply(200, { ok: true });
      case 'rest':
        return expired
          ? reply(401, { code: 'PGRST303', details: null, hint: null, message: 'JWT expired' })
          : reply(200, { ok: true });
      default:
        throw new Error(`unexpected request ${route}`);
    }
  }
  const endSessions = () => {
    unspent.clear();
    for (const token of expiry.keys()) ended.add(token);
  };
  const hold = (path) => {
    let release;
    holds.set(path, new Promise((resolve) => { release = resolve; }));
    return () => release();
  };
  return { clock, fetch, issue, endSessions, hold, outage, requests, refreshes: () => requests.filter((r) => r.route === 'token:refresh_token').length };
}

/* Opens the app on a phone `skew` seconds off the server's clock, with
   `keychain` as what earlier launches left in it, and waits for launch. The
   phone's clock can be moved while the app runs: set `phone.skew`. */
async function launchPhone(auth, { skew, keychain = new Map() }) {
  const { policy, provider } = await nativeSources();
  let launched;
  const ready = new Promise((resolve) => { launched = resolve; });
  const rendered = { value: null, effects: [] };
  const react = {
    createContext: () => ({ Provider: 'MccContext.Provider' }),
    createElement: (type, props) => { rendered.value = props.value; return { type, props }; },
    useContext: () => null,
    useState: (initial) => [initial, (next) => { if (next === true) launched(); }], /* only setReady is given true */
    useRef: (current) => ({ current }),
    useCallback: (fn) => fn,
    useMemo: (make) => make(),
    useEffect: (effect) => { rendered.effects.push(effect); },
  };
  const modules = {
    react: { ...react, default: react },
    'react-native': { Platform: { OS: 'ios' } },
    'expo-secure-store': {
      WHEN_UNLOCKED: 'WHEN_UNLOCKED',
      getItemAsync: async (key) => keychain.get(key) ?? null,
      setItemAsync: async (key, value) => { keychain.set(key, value); },
      deleteItemAsync: async (key) => { keychain.delete(key); },
    },
  };
  const clock = { skew };
  const phone = vm.createContext({
    fetch: auth.fetch,
    phoneClock: () => (auth.clock.now + clock.skew) * 1000,
    __import(spec) {
      assert.ok(spec in modules, `mcc.tsx imports ${spec}, which this fixture does not provide`);
      return modules[spec];
    },
  });
  vm.runInContext('Date.now = () => phoneClock();', phone);
  modules['./sessionPolicy'] = vm.runInContext(policy, phone);
  vm.runInContext(provider, phone).MccProvider({ children: null });
  for (const effect of rendered.effects) effect();
  await ready;
  return { ...rendered.value, keychain, phone: clock };
}

const CLOCKS = [['an hour ahead', 3600], ['an hour behind', -3600], ['on time', 0]];

test('on a phone an hour ahead, an hour behind or on time: one refresh per token lifetime, and no token sent after the server expired it', { timeout: 20_000 }, async () => {
  for (const [phone, skew] of CLOCKS) {
    const auth = authServer();
    const app = await launchPhone(auth, { skew });
    await app.signIn('jane@example.com', 'correct horse battery staple');
    const signedIn = auth.clock.now;
    const answers = [];
    for (let call = 0; call < 37; call += 1) { /* a call every five minutes for three hours */
      answers.push(await app.api('/v1/mnet/feed').then(() => 200, (error) => error.status));
      auth.clock.now += 300;
    }
    assert.deepEqual(answers, Array(37).fill(200), `${phone}: every call is answered`);
    assert.deepEqual(auth.requests.filter((r) => r.expired), [], `${phone}: no request carries a token the server has expired`);
    assert.equal(auth.refreshes(), 3, `${phone}: one refresh per hour-long token, not one per call`);
    assert.deepEqual(
      auth.requests.filter((r) => r.at === signedIn + 3600).map((r) => [r.route, r.token]),
      [['token:refresh_token', null], ['api', 'access-2']],
      `${phone}: the call made as the server expires the first token refreshes first, and goes out on the new one`,
    );
    const stored = JSON.parse(app.keychain.get(SESSION_KEY));
    assert.equal(stored.access_token, 'access-4', phone);
    assert.equal(stored.expires_at - stored.server_expires_at, skew, `${phone}: the keychain keeps both clocks; they differ by the phone’s error`);
  }
});

test('a sign-up that opens a session is stamped on the phone’s clock too', { timeout: 10_000 }, async () => {
  const auth = authServer();
  const app = await launchPhone(auth, { skew: 3600 });
  assert.equal((await app.signUp('jane@example.com', 'correct horse battery staple')).session, true);
  const stored = JSON.parse(app.keychain.get(SESSION_KEY));
  assert.equal(stored.expires_at - stored.server_expires_at, 3600);
  for (let call = 0; call < 6; call += 1) {
    await app.api('/v1/mnet/feed');
    auth.clock.now += 300;
  }
  assert.equal(auth.refreshes(), 0, 'a phone an hour ahead does not refresh the token it has just been given');
});

test('a phone restarted after the server expired its token refreshes before it reads the account; one restarted before does not', { timeout: 10_000 }, async () => {
  /* An hour behind. The server expired the token ten minutes ago, while the
     server's expires_at, read on this phone's clock, would say fifty minutes
     are left: read that way, launch sent the dead token to /auth/v1/user and
     took the server's bad_jwt for a dead session. */
  const behind = authServer(), keychain = new Map();
  await (await launchPhone(behind, { skew: -3600, keychain })).signIn('jane@example.com', 'correct horse battery staple');
  behind.clock.now += 3600 + 600;
  let since = behind.requests.length;
  const restarted = await launchPhone(behind, { skew: -3600, keychain });
  assert.deepEqual(behind.requests.slice(since).map((r) => [r.route, r.token, r.expired]),
    [['token:refresh_token', null, false], ['user', 'access-2', false]],
    'refreshed first, so the account read goes out on a live token');
  assert.equal(await restarted.accessToken(), 'access-2', 'and the member is still signed in');
  assert.equal(JSON.parse(keychain.get(SESSION_KEY)).access_token, 'access-2');

  /* An hour ahead. Fifty minutes are left, while the server's expires_at, read
     on this phone's clock, would say the token expired ten minutes ago. */
  const ahead = authServer(), itsKeychain = new Map();
  await (await launchPhone(ahead, { skew: 3600, keychain: itsKeychain })).signIn('jane@example.com', 'correct horse battery staple');
  ahead.clock.now += 600;
  since = ahead.requests.length;
  const again = await launchPhone(ahead, { skew: 3600, keychain: itsKeychain });
  assert.deepEqual(ahead.requests.slice(since).map((r) => [r.route, r.token]), [['user', 'access-1']], 'a token the server still honours is used, not refreshed');
  assert.equal(await again.accessToken(), 'access-1');
  assert.equal(ahead.refreshes(), 0);
});

test('a session an earlier build stored on the server’s clock is refreshed before its token is used, once', { timeout: 10_000 }, async () => {
  /* What the earlier build kept: the server's expires_at as sent, no server_expires_at. */
  const earlierBuild = (auth) => {
    const { access_token, refresh_token, expires_at, token_type, user } = auth.issue();
    return new Map([[SESSION_KEY, JSON.stringify({ access_token, refresh_token, expires_at, token_type, user: { id: user.id, email: user.email } })]]);
  };

  /* The case it is for: an hour behind, ten minutes after the server expired
     the token, whose expires_at, read on this phone's clock, says fifty
     minutes are left. */
  const behind = authServer(), keychain = earlierBuild(behind);
  behind.clock.now += 3600 + 600;
  const app = await launchPhone(behind, { skew: -3600, keychain });
  assert.deepEqual(behind.requests.map((r) => [r.route, r.token, r.expired]),
    [['token:refresh_token', null, false], ['user', 'access-2', false]],
    'refreshed before the account read: no dead token is sent, and no bad_jwt signs the member out');
  assert.equal(await app.accessToken(), 'access-2');
  const stored = JSON.parse(keychain.get(SESSION_KEY));
  assert.equal(stored.expires_at - stored.server_expires_at, -3600, 'and stored the new way');

  /* What it costs, on any clock, with half the token's life left: one refresh, on the first launch only. */
  for (const [phone, skew] of CLOCKS) {
    const auth = authServer(), kept = earlierBuild(auth);
    auth.clock.now += 1800;
    await launchPhone(auth, { skew, keychain: kept });
    auth.clock.now += 600;
    await launchPhone(auth, { skew, keychain: kept });
    assert.deepEqual(auth.requests.map((r) => [r.route, r.expired]), [['token:refresh_token', false], ['user', false], ['user', false]],
      `${phone}: one refresh, on the first launch only`);
  }
});

/* Signed in on a phone on time, so the token is stamped to expire when the
   server expires it. Then the phone's clock is set back two hours (by hand, or
   by a large NTP correction): read on it, the stamp is now two hours later than
   the server's expiry. The app is relaunched ten minutes after the server
   expired the token, and the phone still believes it fresh, so launch sends it
   to /auth/v1/user and Auth answers 403 bad_jwt. That says the access token has
   expired, not that the session has: its refresh token is still good.
   `prepare` changes the server before the relaunch. */
async function relaunchSetBack(prepare) {
  const auth = authServer(), keychain = new Map();
  const before = await launchPhone(auth, { skew: 0, keychain });
  await before.signIn('jane@example.com', 'correct horse battery staple');
  before.phone.skew = -7200;
  auth.clock.now += 3600 + 600;
  prepare?.(auth);
  const kept = keychain.get(SESSION_KEY), since = auth.requests.length;
  const app = await launchPhone(auth, { skew: before.phone.skew, keychain });
  return { auth, keychain, app, kept, since, launch: auth.requests.slice(since).map((r) => [r.route, r.token, r.expired]) };
}

test('a phone whose clock was set back after sign-in, relaunched after the server expired the token, refreshes once and stays signed in', { timeout: 10_000 }, async () => {
  const { auth, keychain, app, since, launch } = await relaunchSetBack();
  assert.deepEqual(launch, [['user', 'access-1', true], ['token:refresh_token', null, false], ['user', 'access-2', false]],
    'the refused account read refreshes once, then reads again on the new token');
  assert.equal(await app.accessToken(), 'access-2', 'the member is still signed in');
  const stored = JSON.parse(keychain.get(SESSION_KEY));
  assert.equal(stored.access_token, 'access-2', 'and the keychain holds the refreshed session');
  assert.equal(stored.expires_at - stored.server_expires_at, -7200, 'stamped on the phone’s clock as it now reads');
  for (let call = 0; call < 25; call += 1) { /* two more hours, a call every five minutes */
    assert.equal(await app.api('/v1/mnet/feed').then(() => 200, (error) => error.status), 200, `call ${call}`);
    auth.clock.now += 300;
  }
  const refreshed = since + 1;
  assert.equal(auth.requests[refreshed].route, 'token:refresh_token');
  assert.deepEqual(auth.requests.slice(refreshed).filter((r) => r.expired), [], 'no request after the refresh carries a token the server has expired');
  assert.equal(auth.refreshes(), 3, 'that refresh, then one per hour-long token');
});

test('after Auth refuses only the token, the refresh decides: offline or a 5xx keeps the member signed in, a refused refresh signs out', { timeout: 10_000 }, async () => {
  for (const outage of ['offline', 503]) {
    const { keychain, launch, kept } = await relaunchSetBack((auth) => auth.outage.set('token:refresh_token', outage));
    assert.deepEqual(launch, [['user', 'access-1', true], ['token:refresh_token', null, false]], `${outage}: one refresh is tried`);
    assert.equal(keychain.get(SESSION_KEY), kept, `${outage}: the member stays signed in, the keychain untouched`);
  }
  /* Auth refuses every token with a 403 that names no code, even one issued a
     moment ago: refreshed once, not again, and the member is kept. */
  {
    const { keychain, launch } = await relaunchSetBack((auth) => auth.outage.set('user', 403));
    assert.deepEqual(launch, [['user', 'access-1', true], ['token:refresh_token', null, false], ['user', 'access-2', false]],
      'one refresh, however often the token is refused');
    assert.equal(JSON.parse(keychain.get(SESSION_KEY)).access_token, 'access-2', 'the member is kept, with the refreshed session');
  }
  /* The server has also ended the session (a sign-out everywhere), so the
     refresh is refused: that answer, not the token's, signs the member out. */
  const { keychain, app, launch } = await relaunchSetBack((auth) => auth.endSessions());
  assert.deepEqual(launch, [['user', 'access-1', true], ['token:refresh_token', null, false]]);
  assert.equal(keychain.has(SESSION_KEY), false, 'a refused refresh signs the member out');
  await assert.rejects(app.accessToken(), /Sign in first/);
});

test('an account read that names the session as gone still signs out at once, with no refresh', { timeout: 10_000 }, async () => {
  /* A token still within its lifetime, on a phone on time, whose session the
     server has ended: Auth answers 403 session_not_found. */
  const auth = authServer(), keychain = new Map();
  await (await launchPhone(auth, { skew: 0, keychain })).signIn('jane@example.com', 'correct horse battery staple');
  auth.clock.now += 600;
  auth.endSessions();
  const since = auth.requests.length;
  const app = await launchPhone(auth, { skew: 0, keychain });
  assert.deepEqual(auth.requests.slice(since).map((r) => [r.route, r.token, r.expired]), [['user', 'access-1', false]], 'no refresh is spent on it');
  assert.equal(keychain.has(SESSION_KEY), false);
  await assert.rejects(app.accessToken(), /Sign in first/);
});

test('a phone whose clock is set back while the app runs: a call refused for its token is sent once more, on a refreshed one', { timeout: 10_000 }, async () => {
  const auth = authServer();
  const app = await launchPhone(auth, { skew: 0 });
  await app.signIn('jane@example.com', 'correct horse battery staple');
  const setBack = () => { /* two hours back; ten minutes after the server expired the token, the phone still reads it as fresh */
    app.phone.skew -= 7200;
    auth.clock.now += 3600 + 600;
    return auth.requests.length;
  };
  let since = setBack();
  assert.equal((await app.api('/v1/mnet/feed')).ok, true, 'the call is answered');
  assert.deepEqual(auth.requests.slice(since).map((r) => [r.route, r.token, r.status]), [
    ['api', 'access-1', 401], /* the API's own check with Auth failed */
    ['user', 'access-1', 403], /* Auth says why: bad_jwt, the token alone */
    ['token:refresh_token', null, 200],
    ['api', 'access-2', 200],
  ], 'refused, put to Auth, refreshed once, and sent once more');

  /* Two writes at once, one to PostgREST and one to the API: one refresh
     serves both, and each write is sent twice, refused the first time before
     anything ran. */
  since = setBack();
  const answered = await Promise.all([
    app.rpc('join_action_mission', { p_mission_id: 'mission-1' }),
    app.api('/v1/mnet/notifications/read', { method: 'POST', body: {} }),
  ]);
  assert.deepEqual(answered.map((answer) => answer.ok), [true, true]);
  const sent = auth.requests.slice(since);
  assert.equal(sent.filter((r) => r.route === 'token:refresh_token').length, 1, 'one refresh between them');
  for (const path of ['/rest/v1/rpc/join_action_mission', '/v1/mnet/notifications/read']) {
    assert.deepEqual(sent.filter((r) => r.path === path).map((r) => [r.method, r.token, r.status]),
      [['POST', 'access-2', 401], ['POST', 'access-3', 200]], path);
  }
  const refreshed = since + sent.findIndex((r) => r.route === 'token:refresh_token');
  assert.deepEqual(auth.requests.slice(refreshed).filter((r) => r.expired).map((r) => [r.route, r.token]), [],
    'no request after the refresh carries a token the server has expired');
  assert.equal(JSON.parse(app.keychain.get(SESSION_KEY)).access_token, 'access-3');

  /* Once at most: refused again on the new token, a call is not sent a third
     time, and a token Auth accepts is not refreshed. */
  since = setBack();
  auth.outage.set('api', 401);
  for (let call = 0; call < 2; call += 1) assert.equal(await app.api('/v1/mnet/feed').then(() => 200, (error) => error.status), 401);
  assert.deepEqual(auth.requests.slice(since).map((r) => [r.route, r.token, r.status]), [
    ['api', 'access-3', 401], ['user', 'access-3', 403], ['token:refresh_token', null, 200], ['api', 'access-4', 401],
    ['api', 'access-4', 401], ['user', 'access-4', 200],
  ]);
});

test('a 401 its token is not the cause of reaches the caller as it came: nothing refreshed, the member kept, unless Auth says the session is gone', { timeout: 10_000 }, async () => {
  const auth = authServer();
  const app = await launchPhone(auth, { skew: 0 });
  await app.signIn('jane@example.com', 'correct horse battery staple');
  const kept = app.keychain.get(SESSION_KEY);
  const upload = async (times) => {
    const since = auth.requests.length, answers = [];
    for (let call = 0; call < times; call += 1) {
      answers.push(await app.api('/v1/mnet/media/upload-url', { method: 'POST', body: {} }).then(() => 200, (error) => error.status));
    }
    return { answers, sent: auth.requests.slice(since).map((r) => [r.route, r.status]) };
  };
  /* A route that refuses a good token (mnet-media answers 401 to a member
     with no identity link): Auth accepts the token, so nothing is refreshed,
     however often the call is made, and nothing is sent twice. */
  auth.outage.set('api', 401);
  let { answers, sent } = await upload(3);
  assert.deepEqual(answers, [401, 401, 401]);
  assert.deepEqual(sent, Array(3).fill([['api', 401], ['user', 200]]).flat());
  auth.outage.delete('api');
  /* Auth down: the API's gate answers 401, and Auth cannot be asked either.
     The 401 stands, and the same token works once Auth is back. */
  auth.outage.set('user', 503);
  ({ answers, sent } = await upload(2));
  assert.deepEqual(answers, [401, 401]);
  assert.deepEqual(sent, Array(2).fill([['api', 401], ['user', 503]]).flat());
  auth.outage.delete('user');
  assert.equal((await app.api('/v1/mnet/feed')).ok, true);
  assert.equal(auth.refreshes(), 0, 'no refresh spent on any of it');
  assert.equal(app.keychain.get(SESSION_KEY), kept, 'the member is kept, the keychain untouched');
  /* A session ended elsewhere (a sign-out everywhere): Auth names it as
     gone, and it ends here too, as it would at launch. */
  auth.endSessions();
  ({ answers, sent } = await upload(1));
  assert.deepEqual(answers, [401]);
  assert.deepEqual(sent, [['api', 401], ['user', 403]]);
  assert.equal(app.keychain.has(SESSION_KEY), false, 'signed out');
  /* Signed out, a call is refused here before anything is sent: that 401 is never put to Auth. */
  const before = auth.requests.length;
  await assert.rejects(app.api('/v1/mnet/feed'), /Sign in first/);
  assert.equal(auth.requests.length, before, 'nothing sent');
});

test('a call refused while its session changed goes again for the same member, and never under another account', { timeout: 10_000 }, async () => {
  const auth = authServer();
  const app = await launchPhone(auth, { skew: 0 });
  await app.signIn('jane@example.com', 'correct horse battery staple');
  const setBack = () => { app.phone.skew -= 7200; auth.clock.now += 3600 + 600; };
  const posts = () => auth.requests.filter((r) => r.path === '/v1/mnet/posts').map((r) => [r.token, r.status]);

  /* A slow post goes out on a token the server has expired. Meanwhile another
     call is refused, put to Auth and refreshed. When the post's 401 arrives,
     the session has already been renewed for the same member: the post goes
     again on the new token, with no second Auth read and no second refresh. */
  setBack();
  let release = auth.hold('/v1/mnet/posts');
  const slow = app.api('/v1/mnet/posts', { method: 'POST', body: { body: 'hello' } });
  assert.equal((await app.api('/v1/mnet/feed')).ok, true);
  release();
  assert.equal((await slow).ok, true);
  assert.deepEqual(posts(), [['access-1', 401], ['access-2', 200]]);
  assert.deepEqual(auth.requests.filter((r) => r.route === 'user' || r.route === 'token:refresh_token').map((r) => r.route),
    ['user', 'token:refresh_token'], 'one Auth read and one refresh, both the feed call’s');

  /* Again, but meanwhile Jane signs out and Sam signs in: Jane's post is not
     sent again under Sam's account. */
  setBack();
  release = auth.hold('/v1/mnet/posts');
  const stranded = app.api('/v1/mnet/posts', { method: 'POST', body: { body: 'hello again' } });
  await app.signOut();
  await app.signIn('sam@example.com', 'another horse battery staple');
  release();
  await assert.rejects(stranded, (error) => error.code === 'session_changed');
  assert.deepEqual(posts().slice(2), [['access-2', 401]], 'sent once, on Jane’s token, and not again');
  assert.equal((await app.api('/v1/mnet/feed')).ok, true, 'and Sam is signed in, on Sam’s own token');
  assert.equal(auth.requests.at(-1).token, 'access-3');
});
