import { fail, reply } from '../lib/http.js';

const DEFAULT_FEED = 'https://raw.githubusercontent.com/mcclusterishere/Prim3/main/learning/course/course-feed.json';
const COURSE_ID = 'prim3-foundation-v2';
const SOURCE_COURSE_ID = 'prim3-foundation';
const SOURCE_UNIT_COUNT = 21;
const INSTRUCTIONAL_MODULE_COUNT = 63;
const CACHE_SECONDS = 300;

const MODULE_TITLES = [
  ['Alert Triage & Monitoring', 'Scope, Evidence & Search Policy', 'Monitoring Infrastructure & Incident Response'],
  ['White / Grey / Black Hat', 'White / Grey / Black Box', 'Pen-Test Infrastructure, Scope & Remediation'],
  ['Public Sources & Collection', 'Metadata, Corroboration & Confidence', 'Internet Intelligence Infrastructure'],
  ['Social Engineering Patterns', 'Identity Verification & Spoofing', 'Identity Infrastructure & MFA'],
  ['Red & Blue Teams', 'Purple & White Teams', 'Security Engineering Teams & Exercise Operations'],
  ['Wireless Threats & Rogue Access', 'Wi-Fi Protection, Encryption & Interference', 'Wireless Infrastructure: RF to Backhaul'],
  ['Breach Indicators & Access Evidence', 'Ransomware, Credentials & Containment', 'Data Protection, Backup & Incident Response'],
  ['Injection, XSS & Untrusted Input', 'Privilege, RBAC & Browser Defenses', 'Web/App Infrastructure & Secure SDLC'],
  ['Malware Families & Propagation', 'Rootkits, Credentials & Persistence', 'Endpoint Architecture & Malware Defense'],
  ['Install, Upgrade & Multiboot', 'Compatibility, Backup & Rollback', 'Boot, Storage, Drivers & Deployment Infrastructure'],
  ['Residual Data & Media Exposure', 'Physical Topology & RF Remnants', 'Media Sanitization, Cabling & Asset Control'],
  ['IoT Devices, Sensors & Actuators', 'Credentials, Segmentation & Fail-Safe Control', 'Embedded / IoT Infrastructure'],
  ['IaaS vs PaaS vs SaaS', 'Shared Responsibility & Hybrid Architecture', 'Virtualization, Containers & Cloud Infrastructure'],
  ['CapEx vs OpEx', 'Capacity, Load & Ownership Tradeoffs', 'TCO, SLAs & Infrastructure Lifecycle'],
  ['Cloud Compute, Storage & Networking', 'Elasticity, HA & Disaster Recovery', 'Cloud Architecture: Regions, Zones & Load Balancing'],
  ['CPU, Memory & Storage', 'Interfaces, Power & Peripheral Connectivity', 'PC Hardware Architecture & Troubleshooting'],
  ['Patches, Updates & Compatibility', 'Integrity, Secure Coding & Testing', 'Firmware, Patch Management & Rollback'],
  ['Owner Source Required · Part I', 'Owner Source Required · Part II', 'Infrastructure Bridge · Pending Source'],
  ['RAID Levels & Failure Tolerance', 'Hot / Warm / Cold Sites & Failover', 'Storage, Backup, RTO/RPO & Power Resilience'],
  ['Evil Twins & Identity Deception', 'Replay, MITM, Hashes & Web Trust', 'Wireless / Identity Defense & Secure Authentication'],
  ['Network Media & Interfaces', 'Path Tracing, Control & Privilege', 'Cabling, OSI & Network Troubleshooting']
];

const BRIDGE_TOPICS = [
  ['logging and telemetry sources', 'monitoring stacks and alert routing', 'incident-response lifecycle', 'ticketing and evidence retention'],
  ['written authorization and rules of engagement', 'vulnerability-management workflow', 'network and endpoint scope boundaries', 'reporting and remediation'],
  ['DNS and naming infrastructure', 'public registration and certificate metadata', 'source provenance', 'legal and ethical collection boundaries'],
  ['identity and access management', 'authentication factors and MFA', 'SSO and federation', 'help-desk verification controls'],
  ['SOC and incident-response functions', 'exercise control and deconfliction', 'secure software-development roles', 'after-action remediation'],
  ['RF basics and channels', 'access points and controllers', 'wireless authentication', 'DHCP/DNS/backhaul dependencies'],
  ['data classification and encryption', 'backup and recovery', 'DLP and access logging', 'incident response and chain of custody'],
  ['HTTP/TLS request flow', 'application tiers and trust boundaries', 'session and identity controls', 'secure SDLC and defensive gateways'],
  ['processes, services and endpoint persistence', 'EDR and antimalware controls', 'isolation and recovery', 'backup and restoration'],
  ['UEFI/BIOS and boot flow', 'partitioning and file systems', 'drivers and imaging', 'deployment validation and rollback'],
  ['media sanitization and destruction', 'asset inventory and labeling', 'copper/fiber topology', 'RF and EMI fundamentals'],
  ['embedded-device architecture', 'firmware and update paths', 'network segmentation', 'power, sensors and actuators'],
  ['hypervisors and virtual machines', 'containers and orchestration', 'cloud service models', 'network, compute and storage dependencies'],
  ['total cost of ownership', 'capacity planning', 'vendor and SLA considerations', 'asset lifecycle and redundancy'],
  ['regions and availability zones', 'load balancing and autoscaling', 'object/block/file storage', 'high availability and disaster recovery'],
  ['motherboard, CPU and memory relationships', 'storage buses and form factors', 'power delivery', 'systematic hardware troubleshooting'],
  ['firmware and BIOS/UEFI updates', 'code signing and integrity', 'staged deployment and testing', 'rollback and vulnerability management'],
  [],
  ['RAID versus backup', 'RTO and RPO', 'hot/warm/cold recovery sites', 'UPS, power and failure-domain design'],
  ['802.11 trust and authentication', 'identity/session protections', 'DNS and lookalike-domain risk', 'defensive breaks in a compromised trust chain'],
  ['copper, fiber and wireless media', 'OSI layers and packet path', 'switching and routing fundamentals', 'network troubleshooting tools and methodology']
];

const EXAM_ALIGNMENT = [
  ['Security+ SY0-701', 'Network+ N10-009'],
  ['Security+ SY0-701'],
  ['Security+ SY0-701', 'Network+ N10-009'],
  ['A+ 220-1202', 'Security+ SY0-701'],
  ['Security+ SY0-701'],
  ['A+ 220-1201', 'Network+ N10-009', 'Security+ SY0-701'],
  ['A+ 220-1202', 'Security+ SY0-701'],
  ['Security+ SY0-701'],
  ['A+ 220-1202', 'Security+ SY0-701'],
  ['A+ 220-1201', 'A+ 220-1202'],
  ['A+ 220-1201', 'Network+ N10-009'],
  ['A+ 220-1201', 'Network+ N10-009', 'Security+ SY0-701'],
  ['A+ 220-1201', 'Network+ N10-009', 'Security+ SY0-701'],
  ['Network+ N10-009'],
  ['A+ 220-1201', 'Network+ N10-009', 'Security+ SY0-701'],
  ['A+ 220-1201'],
  ['A+ 220-1202', 'Security+ SY0-701'],
  [],
  ['A+ 220-1201', 'Network+ N10-009', 'Security+ SY0-701'],
  ['Network+ N10-009', 'Security+ SY0-701'],
  ['A+ 220-1201', 'Network+ N10-009']
];

function feedUrl(env) {
  return String(env.PRIM3_COURSE_FEED_URL || DEFAULT_FEED).trim();
}

function databaseConfigured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra
  };
}

async function authUser(request, env) {
  if (!databaseConfigured(env)) return null;
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization }
  });
  if (!response.ok) return null;
  return response.json();
}

async function requireLearner(request, env) {
  const user = await authUser(request, env);
  if (!user) throw Object.assign(new Error('M Account required for the free PRIM3 course'), { status: 401 });
  return user;
}

async function dbRequest(env, path, options = {}) {
  if (!databaseConfigured(env)) throw Object.assign(new Error('McCluster learner database is not configured'), { status: 503 });
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: serviceHeaders(env, options.headers || {})
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw Object.assign(new Error('PRIM3 learner database request failed'), { status: response.status, detail: data });
  return data;
}

function validSourceUnit(module, index) {
  return Boolean(
    module && typeof module === 'object' && /^M\d{2}$/.test(String(module.id || '')) &&
    Number(module.sequence) === index + 1 && Number.isInteger(Number(module.season)) &&
    typeof module.episode_id === 'string' && typeof module.episode_title === 'string' &&
    Array.isArray(module.concepts) && Array.isArray(module.objectives) && module.sources && Array.isArray(module.sources)
  );
}

function validateFeed(payload) {
  if (!payload || typeof payload !== 'object') throw Object.assign(new Error('PRIM3 course feed is not an object'), { status: 502 });
  if (payload.schema_version !== '1.0.0') throw Object.assign(new Error('Unsupported PRIM3 source feed schema'), { status: 502 });
  if (!payload.course || payload.course.id !== SOURCE_COURSE_ID) throw Object.assign(new Error('Unexpected PRIM3 source identity'), { status: 502 });
  if (!Array.isArray(payload.course.modules) || payload.course.modules.length !== SOURCE_UNIT_COUNT) {
    throw Object.assign(new Error(`PRIM3 source feed must publish exactly ${SOURCE_UNIT_COUNT} episode/song units`), { status: 502 });
  }
  payload.course.modules.forEach((module, index) => {
    if (!validSourceUnit(module, index)) throw Object.assign(new Error(`Invalid PRIM3 source unit at sequence ${index + 1}`), { status: 502 });
  });
  return payload;
}

async function fetchSource(env) {
  const source = feedUrl(env);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(source, { method: 'GET' });

  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const payload = validateFeed(await hit.json());
      return { payload, meta: { repo: 'mcclusterishere/Prim3', branch: 'main', path: 'learning/course/course-feed.json', source_url: source, cache: 'hit', etag: hit.headers.get('etag') || null, fetched_at: hit.headers.get('x-prim3-fetched-at') || null } };
    }
  }

  const upstream = await fetch(source, { headers: { accept: 'application/json', 'user-agent': 'McCluster-PRIM3-Course-Ingest/2.0' } });
  if (!upstream.ok) throw Object.assign(new Error(`PRIM3 source feed returned ${upstream.status}`), { status: 502 });
  const text = await upstream.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw Object.assign(new Error('PRIM3 source feed is not valid JSON'), { status: 502 }); }
  validateFeed(payload);

  const fetchedAt = new Date().toISOString();
  const etag = upstream.headers.get('etag') || null;
  if (cache) {
    const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${CACHE_SECONDS}`, 'x-prim3-fetched-at': fetchedAt });
    if (etag) headers.set('etag', etag);
    await cache.put(cacheKey, new Response(JSON.stringify(payload), { status: 200, headers }));
  }
  return { payload, meta: { repo: 'mcclusterishere/Prim3', branch: 'main', path: 'learning/course/course-feed.json', source_url: source, cache: 'miss', etag, fetched_at: fetchedAt } };
}

function splitCoreConcepts(unit, unitIndex) {
  const concepts = Array.isArray(unit.concepts) ? unit.concepts.slice() : [];
  if (unitIndex === 4) {
    return [
      concepts.filter((c) => ['red team', 'blue team'].includes(String(c).toLowerCase())),
      concepts.filter((c) => ['purple team', 'white team'].includes(String(c).toLowerCase()))
    ];
  }
  const cut = Math.max(1, Math.ceil(concepts.length / 2));
  return [concepts.slice(0, cut), concepts.slice(cut)];
}

function instructionalModuleId(sequence) {
  return `M${String(sequence).padStart(2, '0')}`;
}

function expandUnit(unit, unitIndex) {
  const titles = MODULE_TITLES[unitIndex];
  const bridge = BRIDGE_TOPICS[unitIndex] || [];
  const exams = EXAM_ALIGNMENT[unitIndex] || [];
  const [coreA, coreB] = splitCoreConcepts(unit, unitIndex);
  const sourceLocked = unit.status === 'owner-source-required';
  const base = {
    unit_id: `U${String(unitIndex + 1).padStart(2, '0')}`,
    unit_sequence: unitIndex + 1,
    season: Number(unit.season),
    episode_id: unit.episode_id,
    episode_title: unit.episode_title,
    song: unit.song ?? null,
    source_slug: unit.source_slug ?? null,
    labs: unit.labs || {},
    sources: unit.sources || []
  };
  const firstSequence = unitIndex * 3 + 1;
  const sourceObjectives = unit.objectives || [];
  const coreObjective = (part) => [
    `Explain the ${part === 1 ? 'first' : 'second'} concept cluster from ${unit.song || unit.episode_title} without mixing it with a separate concept family.`,
    sourceObjectives[part - 1] || sourceObjectives[0] || 'Explain the source concepts accurately.',
    'Use the vocabulary in a short scenario before moving to the next concept cluster.'
  ];
  const bridgeObjectives = sourceLocked ? [] : [
    'Explain the infrastructure, hardware, services or operational processes underneath the episode concepts.',
    'Connect the episode vocabulary to relevant current CompTIA objective families without treating the song as complete exam coverage.',
    'Apply the missing foundation material in a troubleshooting, design or response scenario.'
  ];

  return [
    { ...base, id: instructionalModuleId(firstSequence), sequence: firstSequence, part: 1, part_label: 'SONG CORE A', title: titles[0], status: sourceLocked ? 'owner-source-required' : 'source-aligned', curriculum_origin: 'prim3-source', concepts: coreA, objectives: sourceLocked ? [] : coreObjective(1), exam_alignment: [] },
    { ...base, id: instructionalModuleId(firstSequence + 1), sequence: firstSequence + 1, part: 2, part_label: 'SONG CORE B', title: titles[1], status: sourceLocked ? 'owner-source-required' : 'source-aligned', curriculum_origin: 'prim3-source', concepts: coreB, objectives: sourceLocked ? [] : coreObjective(2), exam_alignment: [] },
    { ...base, id: instructionalModuleId(firstSequence + 2), sequence: firstSequence + 2, part: 3, part_label: 'INFRASTRUCTURE + EXAM BRIDGE', title: titles[2], status: sourceLocked ? 'owner-source-required' : 'enrichment', curriculum_origin: 'mccluster-enrichment', concepts: bridge, objectives: bridgeObjectives, exam_alignment: exams }
  ];
}

function normalizedCourse(payload) {
  const sourceCourse = payload.course;
  const units = sourceCourse.modules.map((unit, index) => ({
    id: `U${String(index + 1).padStart(2, '0')}`,
    sequence: index + 1,
    season: Number(unit.season),
    episode_id: unit.episode_id,
    episode_title: unit.episode_title,
    song: unit.song ?? null,
    status: unit.status,
    source_slug: unit.source_slug ?? null,
    concepts: unit.concepts || [],
    objectives: unit.objectives || [],
    labs: unit.labs || {},
    sources: unit.sources || []
  }));
  const modules = sourceCourse.modules.flatMap(expandUnit);
  return {
    id: COURSE_ID,
    source_course_id: SOURCE_COURSE_ID,
    title: 'PRIM3 Foundation',
    subtitle: 'Program for Resilient Infrastructure Management',
    schema_version: '2.0.0',
    source_schema_version: payload.schema_version,
    pass_mark: Number(sourceCourse.pass_mark || 80),
    progression: 'guided',
    account_required: true,
    price_cents: 0,
    source_unit_count: units.length,
    module_count: modules.length,
    module_strategy: '3 instructional modules per episode/song unit',
    source_authorities: Array.isArray(sourceCourse.source_authorities) ? sourceCourse.source_authorities : [],
    layers: Array.isArray(sourceCourse.layers) ? sourceCourse.layers : [],
    units,
    modules
  };
}

async function getProgress(request, env) {
  const user = await requireLearner(request, env);
  const rows = await dbRequest(env, `prim3_course_progress?user_id=eq.${encodeURIComponent(user.id)}&course_id=eq.${encodeURIComponent(COURSE_ID)}&order=module_id.asc&select=module_id,reading_completed_at,assessment_score,assessment_attempts,passed_at,mastery,last_activity_at,updated_at`);
  return reply(request, env, { ok: true, course_id: COURSE_ID, user_id: user.id, progress: rows || [] });
}

async function saveProgress(request, env, moduleId) {
  const user = await requireLearner(request, env);
  const source = await fetchSource(env);
  const course = normalizedCourse(source.payload);
  const module = course.modules.find((item) => item.id === moduleId);
  if (!module) return fail(request, env, 'PRIM3 module not found', 404);

  let body;
  try { body = await request.json(); } catch { return fail(request, env, 'Valid JSON body required', 400); }
  const now = new Date().toISOString();
  const scoreProvided = body.assessment_score !== undefined && body.assessment_score !== null;
  const incomingScore = scoreProvided ? Math.round(Number(body.assessment_score)) : null;
  if (scoreProvided && (!Number.isFinite(incomingScore) || incomingScore < 0 || incomingScore > 100)) return fail(request, env, 'assessment_score must be 0 through 100', 400);

  const existing = await dbRequest(env, `prim3_course_progress?user_id=eq.${encodeURIComponent(user.id)}&course_id=eq.${encodeURIComponent(COURSE_ID)}&module_id=eq.${encodeURIComponent(moduleId)}&select=assessment_attempts,assessment_score,reading_completed_at,passed_at,mastery&limit=1`);
  const previous = existing?.[0] || {};
  const previousScore = Number(previous.assessment_score);
  const bestScore = scoreProvided ? (Number.isFinite(previousScore) ? Math.max(previousScore, incomingScore) : incomingScore) : (Number.isFinite(previousScore) ? previousScore : null);
  const readingCompleted = body.reading_completed === true || Boolean(previous.reading_completed_at);
  const attempts = Number(previous.assessment_attempts || 0) + (scoreProvided ? 1 : 0);
  const passedAt = previous.passed_at || (bestScore !== null && bestScore >= course.pass_mark ? now : null);
  const incomingMastery = body.mastery && typeof body.mastery === 'object' && !Array.isArray(body.mastery) ? body.mastery : {};
  const previousMastery = previous.mastery && typeof previous.mastery === 'object' && !Array.isArray(previous.mastery) ? previous.mastery : {};

  const row = {
    user_id: user.id,
    course_id: COURSE_ID,
    module_id: moduleId,
    reading_completed_at: readingCompleted ? (previous.reading_completed_at || now) : null,
    assessment_score: bestScore,
    assessment_attempts: attempts,
    passed_at: passedAt,
    mastery: { ...previousMastery, ...incomingMastery },
    last_activity_at: now,
    updated_at: now
  };

  const rows = await dbRequest(env, 'prim3_course_progress?on_conflict=user_id,course_id,module_id', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row) });
  return reply(request, env, { ok: true, course_id: COURSE_ID, progress: rows?.[0] || row });
}

async function resetProgress(request, env) {
  const user = await requireLearner(request, env);
  await dbRequest(env, `prim3_course_progress?user_id=eq.${encodeURIComponent(user.id)}&course_id=eq.${encodeURIComponent(COURSE_ID)}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
  return reply(request, env, { ok: true, course_id: COURSE_ID, reset: true });
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/v1/prim3/progress') {
    if (request.method === 'GET') return getProgress(request, env);
    if (request.method === 'DELETE') return resetProgress(request, env);
    return fail(request, env, 'Method not allowed', 405);
  }

  const progressMatch = path.match(/^\/v1\/prim3\/progress\/(M\d{2})$/i);
  if (progressMatch) {
    if (request.method !== 'POST') return fail(request, env, 'Method not allowed', 405);
    return saveProgress(request, env, progressMatch[1].toUpperCase());
  }

  if (request.method !== 'GET') return fail(request, env, 'Method not allowed', 405);
  await requireLearner(request, env);
  const source = await fetchSource(env);
  const course = normalizedCourse(source.payload);

  if (path === '/v1/prim3' || path === '/v1/prim3/course') return reply(request, env, { ok: true, source: source.meta, course });

  if (path === '/v1/prim3/course/health') {
    return reply(request, env, {
      ok: true,
      source: source.meta,
      learner_progress: { configured: databaseConfigured(env), account_required: true },
      course: { id: course.id, schema_version: course.schema_version, source_unit_count: course.source_unit_count, module_count: course.module_count, free_after_account: true, protected_open_unit: course.units.some((unit) => unit.id === 'U18' && unit.status === 'owner-source-required') }
    });
  }

  const match = path.match(/^\/v1\/prim3\/course\/modules\/(M\d{2})$/i);
  if (match) {
    const id = match[1].toUpperCase();
    const module = course.modules.find((item) => item.id === id);
    if (!module) return fail(request, env, 'PRIM3 module not found', 404);
    return reply(request, env, { ok: true, source: source.meta, course_id: course.id, module });
  }

  const unitMatch = path.match(/^\/v1\/prim3\/course\/units\/(U\d{2})$/i);
  if (unitMatch) {
    const id = unitMatch[1].toUpperCase();
    const unit = course.units.find((item) => item.id === id);
    if (!unit) return fail(request, env, 'PRIM3 source unit not found', 404);
    return reply(request, env, { ok: true, source: source.meta, course_id: course.id, unit });
  }

  return fail(request, env, 'PRIM3 route not found', 404);
}

export default { fetch: route };
