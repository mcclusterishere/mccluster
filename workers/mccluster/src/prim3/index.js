import { fail, reply } from '../lib/http.js';

const DEFAULT_FEED = 'https://raw.githubusercontent.com/mcclusterishere/Prim3/main/learning/course/course-feed.json';
const COURSE_ID = 'prim3-foundation-v3';
const SOURCE_COURSE_ID = 'prim3-foundation';
const SOURCE_UNIT_COUNT = 21;
const FOUNDATION_MODULE_COUNT = 3;
const SONG_ALIGNED_MODULE_COUNT = SOURCE_UNIT_COUNT * 3;
const INSTRUCTIONAL_MODULE_COUNT = FOUNDATION_MODULE_COUNT + SONG_ALIGNED_MODULE_COUNT;
const CACHE_SECONDS = 300;

const MODULE_TITLES = [
  ['Alert Triage and Monitoring', 'Scope, Evidence and Search Policy', 'Monitoring Infrastructure and Incident Response'],
  ['White Grey Black Hat', 'White Grey Black Box', 'Penetration Testing Infrastructure, Scope and Remediation'],
  ['Public Sources and Collection', 'Metadata, Corroboration and Confidence', 'Internet Intelligence Infrastructure'],
  ['Social Engineering Patterns', 'Identity Verification and Spoofing', 'Identity Infrastructure and Multifactor Authentication'],
  ['Red and Blue Teams', 'Purple and White Teams', 'Security Engineering Teams and Exercise Operations'],
  ['Wireless Threats and Rogue Access', 'Wireless Protection, Encryption and Interference', 'Wireless Infrastructure from Radio to Backhaul'],
  ['Breach Indicators and Access Evidence', 'Ransomware, Credentials and Containment', 'Data Protection, Backup and Incident Response'],
  ['Injection, Cross Site Scripting and Untrusted Input', 'Privilege, Access Control and Browser Defenses', 'Application Infrastructure and Secure Development'],
  ['Malware Families and Propagation', 'Rootkits, Credentials and Persistence', 'Endpoint Architecture and Malware Defense'],
  ['Install, Upgrade and Multiple Boot Environments', 'Compatibility, Backup and Rollback', 'Boot, Storage, Drivers and Deployment Infrastructure'],
  ['Residual Data and Media Exposure', 'Physical Topology and Radio Remnants', 'Media Sanitization, Cabling and Asset Control'],
  ['Connected Devices, Sensors and Actuators', 'Credentials, Segmentation and Safe Control', 'Embedded and Connected Device Infrastructure'],
  ['Infrastructure, Platform and Software Services', 'Shared Responsibility and Hybrid Architecture', 'Virtualization, Containers and Cloud Infrastructure'],
  ['Capital Expense and Operating Expense', 'Capacity, Load and Ownership Tradeoffs', 'Total Cost, Service Agreements and Infrastructure Lifecycle'],
  ['Cloud Compute, Storage and Networking', 'Elasticity, Availability and Disaster Recovery', 'Cloud Architecture with Regions, Zones and Load Balancing'],
  ['Processor, Memory and Storage', 'Interfaces, Power and Peripheral Connectivity', 'Computer Hardware Architecture and Troubleshooting'],
  ['Patches, Updates and Compatibility', 'Integrity, Secure Coding and Testing', 'Firmware, Patch Management and Rollback'],
  ['Owner Source Required Part One', 'Owner Source Required Part Two', 'Infrastructure Bridge Pending Source'],
  ['RAID Levels and Failure Tolerance', 'Hot Warm and Cold Sites', 'Storage, Backup, Recovery Objectives and Power Resilience'],
  ['Evil Twins and Identity Deception', 'Replay, Interception, Hashes and Web Trust', 'Wireless Identity Defense and Secure Authentication'],
  ['Network Media and Interfaces', 'Path Tracing, Control and Privilege', 'Cabling, Network Layers and Troubleshooting']
];

const BRIDGE_TOPICS = [
  ['logging and telemetry sources', 'monitoring stacks and alert routing', 'incident response lifecycle', 'ticketing and evidence retention'],
  ['written authorization and rules of engagement', 'vulnerability management workflow', 'network and endpoint scope boundaries', 'reporting and remediation'],
  ['name resolution infrastructure', 'public registration and certificate metadata', 'source provenance', 'legal and ethical collection boundaries'],
  ['identity and access management', 'authentication factors and multifactor authentication', 'single sign on and federation', 'support desk verification controls'],
  ['security operations and incident response functions', 'exercise control and deconfliction', 'secure software development roles', 'after action remediation'],
  ['radio frequency basics and channels', 'access points and controllers', 'wireless authentication', 'address assignment name resolution and backhaul dependencies'],
  ['data classification and encryption', 'backup and recovery', 'data loss prevention and access logging', 'incident response and chain of custody'],
  ['web request and transport security flow', 'application tiers and trust boundaries', 'session and identity controls', 'secure development and defensive gateways'],
  ['processes services and endpoint persistence', 'endpoint detection and malware controls', 'isolation and recovery', 'backup and restoration'],
  ['firmware boot flow', 'partitioning and file systems', 'drivers and imaging', 'deployment validation and rollback'],
  ['media sanitization and destruction', 'asset inventory and labeling', 'copper and fiber topology', 'radio and electromagnetic fundamentals'],
  ['embedded device architecture', 'firmware and update paths', 'network segmentation', 'power sensors and actuators'],
  ['hypervisors and virtual machines', 'containers and orchestration', 'cloud service models', 'network compute and storage dependencies'],
  ['total cost of ownership', 'capacity planning', 'vendor and service agreement considerations', 'asset lifecycle and redundancy'],
  ['regions and availability zones', 'load balancing and automatic scaling', 'object block and file storage', 'high availability and disaster recovery'],
  ['motherboard processor and memory relationships', 'storage buses and form factors', 'power delivery', 'systematic hardware troubleshooting'],
  ['firmware updates', 'code signing and integrity', 'staged deployment and testing', 'rollback and vulnerability management'],
  [],
  ['RAID versus backup', 'recovery time and recovery point objectives', 'hot warm and cold recovery sites', 'power backup and failure domain design'],
  ['wireless trust and authentication', 'identity and session protections', 'name resolution and lookalike domain risk', 'defensive breaks in a compromised trust chain'],
  ['copper fiber and wireless media', 'network layers and packet path', 'switching and routing fundamentals', 'network troubleshooting tools and methodology']
];

const EXAM_ALIGNMENT = [
  ['Security+ SY0-701', 'Network+ N10-009'],
  ['Security+ SY0-701'],
  ['Security+ SY0-701', 'Network+ N10-009'],
  ['Security+ SY0-701'],
  ['Security+ SY0-701'],
  ['Network+ N10-009', 'Security+ SY0-701'],
  ['Security+ SY0-701'],
  ['Security+ SY0-701'],
  ['Security+ SY0-701'],
  ['Network+ N10-009'],
  ['Network+ N10-009', 'Security+ SY0-701'],
  ['Network+ N10-009', 'Security+ SY0-701'],
  ['Network+ N10-009', 'Security+ SY0-701'],
  ['Network+ N10-009'],
  ['Network+ N10-009', 'Security+ SY0-701'],
  ['Network+ N10-009'],
  ['Security+ SY0-701'],
  [],
  ['Network+ N10-009', 'Security+ SY0-701'],
  ['Network+ N10-009', 'Security+ SY0-701'],
  ['Network+ N10-009']
];

function foundationModules() {
  const shared = {
    foundation: true,
    unit_id: null,
    unit_sequence: null,
    season: 0,
    episode_id: null,
    episode_title: null,
    song: null,
    source_slug: null,
    labs: {},
    sources: ['docs/prim3/COMPTIA-COVERAGE.json'],
    part: null,
    part_label: 'CERTIFICATION FOUNDATION',
    status: 'foundation',
    curriculum_origin: 'mccluster-certification-foundation',
    source_concepts: []
  };
  return [
    {
      ...shared,
      id: 'M01',
      sequence: 1,
      title: 'Security Foundations and Risk',
      concepts: ['confidentiality', 'integrity', 'availability', 'threat', 'vulnerability', 'risk', 'likelihood', 'impact', 'security controls', 'data states', 'zero trust', 'shared responsibility', 'governance'],
      enrichment_concepts: ['confidentiality', 'integrity', 'availability', 'threat', 'vulnerability', 'risk', 'likelihood', 'impact', 'security controls', 'data states', 'zero trust', 'shared responsibility', 'governance'],
      objectives: [
        'Explain the core security goals of confidentiality, integrity and availability.',
        'Distinguish threats, vulnerabilities, likelihood, impact and risk.',
        'Recognize foundational control, governance, data protection and trust concepts before song aligned study begins.'
      ],
      exam_alignment: ['Security+ SY0-701 1.1', 'Security+ SY0-701 1.2', 'Security+ SY0-701 1.3', 'Security+ SY0-701 1.4']
    },
    {
      ...shared,
      id: 'M02',
      sequence: 2,
      title: 'Networking Foundations',
      concepts: ['network models', 'hosts', 'clients', 'servers', 'media access addresses', 'internet protocol addresses', 'subnets', 'default gateways', 'switches', 'routers', 'firewalls', 'name resolution', 'address assignment', 'network address translation', 'ports', 'protocols', 'traffic flow'],
      enrichment_concepts: ['network models', 'hosts', 'clients', 'servers', 'media access addresses', 'internet protocol addresses', 'subnets', 'default gateways', 'switches', 'routers', 'firewalls', 'name resolution', 'address assignment', 'network address translation', 'ports', 'protocols', 'traffic flow'],
      objectives: [
        'Explain how hosts communicate through layered network models.',
        'Identify the roles of addressing, switching, routing, name resolution and address assignment.',
        'Use ports, protocols, network devices and traffic flow as a foundation for later troubleshooting and security modules.'
      ],
      exam_alignment: ['Network+ N10-009 1.1', 'Network+ N10-009 1.2', 'Network+ N10-009 1.3', 'Network+ N10-009 1.4', 'Network+ N10-009 1.5']
    },
    {
      ...shared,
      id: 'M03',
      sequence: 3,
      title: 'Identity, Cryptography and Access',
      concepts: ['identification', 'authentication', 'authorization', 'accounting', 'authentication factors', 'multifactor authentication', 'single sign on', 'federation', 'least privilege', 'role based access', 'attribute based access', 'symmetric encryption', 'asymmetric encryption', 'hashing', 'digital signatures', 'certificates', 'public key infrastructure', 'key management'],
      enrichment_concepts: ['identification', 'authentication', 'authorization', 'accounting', 'authentication factors', 'multifactor authentication', 'single sign on', 'federation', 'least privilege', 'role based access', 'attribute based access', 'symmetric encryption', 'asymmetric encryption', 'hashing', 'digital signatures', 'certificates', 'public key infrastructure', 'key management'],
      objectives: [
        'Distinguish identification, authentication, authorization and accounting.',
        'Explain access models, authentication factors, multifactor authentication, federation and least privilege.',
        'Explain the purpose of encryption, hashing, digital signatures, certificates and key management.'
      ],
      exam_alignment: ['Security+ SY0-701 1.4', 'Security+ SY0-701 3.1', 'Security+ SY0-701 4.6', 'Network+ N10-009 4.1']
    }
  ];
}

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
    module &&
    typeof module === 'object' &&
    /^M\d{2}$/.test(String(module.id || '')) &&
    Number(module.sequence) === index + 1 &&
    Number.isInteger(Number(module.season)) &&
    typeof module.episode_id === 'string' &&
    typeof module.episode_title === 'string' &&
    Array.isArray(module.concepts) &&
    Array.isArray(module.objectives) &&
    module.sources && Array.isArray(module.sources)
  );
}

function validateFeed(payload) {
  if (!payload || typeof payload !== 'object') throw Object.assign(new Error('PRIM3 course feed is not an object'), { status: 502 });
  if (payload.schema_version !== '1.0.0') throw Object.assign(new Error('Unsupported PRIM3 source feed schema'), { status: 502 });
  if (!payload.course || payload.course.id !== SOURCE_COURSE_ID) throw Object.assign(new Error('Unexpected PRIM3 source identity'), { status: 502 });
  if (!Array.isArray(payload.course.modules) || payload.course.modules.length !== SOURCE_UNIT_COUNT) {
    throw Object.assign(new Error(`PRIM3 source feed must publish exactly ${SOURCE_UNIT_COUNT} episode and song units`), { status: 502 });
  }
  payload.course.modules.forEach((module, index) => {
    if (!validSourceUnit(module, index)) {
      throw Object.assign(new Error(`Invalid PRIM3 source unit at sequence ${index + 1}`), { status: 502 });
    }
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
      return {
        payload,
        meta: {
          repo: 'mcclusterishere/Prim3',
          branch: 'main',
          path: 'learning/course/course-feed.json',
          source_url: source,
          cache: 'hit',
          etag: hit.headers.get('etag') || null,
          fetched_at: hit.headers.get('x-prim3-fetched-at') || null
        }
      };
    }
  }

  const upstream = await fetch(source, {
    headers: {
      accept: 'application/json',
      'user-agent': 'McCluster-PRIM3-Course-Ingest/3.0'
    }
  });
  if (!upstream.ok) {
    throw Object.assign(new Error(`PRIM3 source feed returned ${upstream.status}`), { status: 502 });
  }

  const text = await upstream.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw Object.assign(new Error('PRIM3 source feed is not valid JSON'), { status: 502 });
  }
  validateFeed(payload);

  const fetchedAt = new Date().toISOString();
  const etag = upstream.headers.get('etag') || null;
  if (cache) {
    const headers = new Headers({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
      'x-prim3-fetched-at': fetchedAt
    });
    if (etag) headers.set('etag', etag);
    await cache.put(cacheKey, new Response(JSON.stringify(payload), { status: 200, headers }));
  }

  return {
    payload,
    meta: {
      repo: 'mcclusterishere/Prim3',
      branch: 'main',
      path: 'learning/course/course-feed.json',
      source_url: source,
      cache: 'miss',
      etag,
      fetched_at: fetchedAt
    }
  };
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
  const sourceConcepts = Array.isArray(unit.concepts) ? unit.concepts.slice() : [];
  const usedCore = new Set([...coreA, ...coreB].map((concept) => String(concept).toLowerCase()));
  const sourceRemainder = sourceConcepts.filter((concept) => !usedCore.has(String(concept).toLowerCase()));
  const bridgeConcepts = [...sourceRemainder, ...bridge];
  const bridgeOrigin = sourceRemainder.length ? 'prim3-source+mccluster-enrichment' : 'mccluster-enrichment';
  const sourceLocked = unit.status === 'owner-source-required';
  const base = {
    foundation: false,
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
  const firstSequence = FOUNDATION_MODULE_COUNT + unitIndex * 3 + 1;
  const sourceObjectives = unit.objectives || [];
  const coreObjective = (part) => [
    `Explain the ${part === 1 ? 'first' : 'second'} concept cluster from ${unit.song || unit.episode_title} without mixing it with a separate concept family.`,
    sourceObjectives[part - 1] || sourceObjectives[0] || 'Explain the source concepts accurately.',
    'Use the vocabulary in a short scenario before moving to the next concept cluster.'
  ];
  const bridgeObjectives = sourceLocked ? [] : [
    'Explain the infrastructure, hardware, services or operational processes underneath the episode concepts.',
    'Connect the episode vocabulary to relevant Security Plus and Network Plus objectives without treating the song as complete exam coverage.',
    'Apply missing foundation material in a troubleshooting, design or response scenario.'
  ];

  return [
    {
      ...base,
      id: instructionalModuleId(firstSequence),
      sequence: firstSequence,
      part: 1,
      part_label: 'SONG CORE A',
      title: titles[0],
      status: sourceLocked ? 'owner-source-required' : 'source-aligned',
      curriculum_origin: 'prim3-source',
      concepts: coreA,
      source_concepts: coreA,
      enrichment_concepts: [],
      objectives: sourceLocked ? [] : coreObjective(1),
      exam_alignment: []
    },
    {
      ...base,
      id: instructionalModuleId(firstSequence + 1),
      sequence: firstSequence + 1,
      part: 2,
      part_label: 'SONG CORE B',
      title: titles[1],
      status: sourceLocked ? 'owner-source-required' : 'source-aligned',
      curriculum_origin: 'prim3-source',
      concepts: coreB,
      source_concepts: coreB,
      enrichment_concepts: [],
      objectives: sourceLocked ? [] : coreObjective(2),
      exam_alignment: []
    },
    {
      ...base,
      id: instructionalModuleId(firstSequence + 2),
      sequence: firstSequence + 2,
      part: 3,
      part_label: 'INFRASTRUCTURE AND EXAM BRIDGE',
      title: titles[2],
      status: sourceLocked ? 'owner-source-required' : 'enrichment',
      curriculum_origin: bridgeOrigin,
      concepts: bridgeConcepts,
      source_concepts: sourceRemainder,
      enrichment_concepts: bridge,
      objectives: bridgeObjectives,
      exam_alignment: exams
    }
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
  const modules = [...foundationModules(), ...sourceCourse.modules.flatMap(expandUnit)];
  if (modules.length !== INSTRUCTIONAL_MODULE_COUNT) {
    throw Object.assign(new Error(`PRIM3 curriculum adapter must publish exactly ${INSTRUCTIONAL_MODULE_COUNT} instructional modules`), { status: 502 });
  }
  modules.forEach((module, index) => {
    if (module.id !== instructionalModuleId(index + 1) || Number(module.sequence) !== index + 1) {
      throw Object.assign(new Error(`Invalid PRIM3 instructional module ordering at sequence ${index + 1}`), { status: 502 });
    }
  });

  return {
    id: COURSE_ID,
    source_course_id: SOURCE_COURSE_ID,
    title: 'PRIM3 Foundation',
    subtitle: 'Program for Resilient Infrastructure Management',
    schema_version: '3.0.0',
    source_schema_version: payload.schema_version,
    pass_mark: Number(sourceCourse.pass_mark || 80),
    progression: 'guided',
    account_required: true,
    price_cents: 0,
    source_unit_count: units.length,
    foundation_module_count: FOUNDATION_MODULE_COUNT,
    song_aligned_module_count: SONG_ALIGNED_MODULE_COUNT,
    module_count: modules.length,
    module_strategy: '3 certification foundation modules plus 3 instructional modules per episode and song unit',
    mandatory_certifications: ['Security+ SY0-701', 'Network+ N10-009'],
    source_authorities: Array.isArray(sourceCourse.source_authorities) ? sourceCourse.source_authorities : [],
    layers: Array.isArray(sourceCourse.layers) ? sourceCourse.layers : [],
    units,
    modules
  };
}

async function getProgress(request, env) {
  const user = await requireLearner(request, env);
  const rows = await dbRequest(
    env,
    `prim3_course_progress?user_id=eq.${encodeURIComponent(user.id)}&course_id=eq.${encodeURIComponent(COURSE_ID)}&order=module_id.asc&select=module_id,reading_completed_at,assessment_score,assessment_attempts,passed_at,mastery,last_activity_at,updated_at`
  );
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
  if (scoreProvided && (!Number.isFinite(incomingScore) || incomingScore < 0 || incomingScore > 100)) {
    return fail(request, env, 'assessment_score must be 0 through 100', 400);
  }

  const existing = await dbRequest(
    env,
    `prim3_course_progress?user_id=eq.${encodeURIComponent(user.id)}&course_id=eq.${encodeURIComponent(COURSE_ID)}&module_id=eq.${encodeURIComponent(moduleId)}&select=assessment_attempts,assessment_score,reading_completed_at,passed_at,mastery&limit=1`
  );
  const previous = existing?.[0] || {};
  const previousScore = Number(previous.assessment_score);
  const bestScore = scoreProvided
    ? (Number.isFinite(previousScore) ? Math.max(previousScore, incomingScore) : incomingScore)
    : (Number.isFinite(previousScore) ? previousScore : null);
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

  const rows = await dbRequest(
    env,
    'prim3_course_progress?on_conflict=user_id,course_id,module_id',
    {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(row)
    }
  );
  return reply(request, env, { ok: true, course_id: COURSE_ID, progress: rows?.[0] || row });
}

async function resetProgress(request, env) {
  const user = await requireLearner(request, env);
  await dbRequest(
    env,
    `prim3_course_progress?user_id=eq.${encodeURIComponent(user.id)}&course_id=eq.${encodeURIComponent(COURSE_ID)}`,
    { method: 'DELETE', headers: { prefer: 'return=minimal' } }
  );
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

  if (path === '/v1/prim3' || path === '/v1/prim3/course') {
    return reply(request, env, { ok: true, source: source.meta, course });
  }

  if (path === '/v1/prim3/course/health') {
    return reply(request, env, {
      ok: true,
      source: source.meta,
      learner_progress: { configured: databaseConfigured(env), account_required: true },
      course: {
        id: course.id,
        schema_version: course.schema_version,
        source_unit_count: course.source_unit_count,
        foundation_module_count: course.foundation_module_count,
        song_aligned_module_count: course.song_aligned_module_count,
        module_count: course.module_count,
        free_after_account: true,
        protected_open_unit: course.units.some((unit) => unit.status === 'owner-source-required')
      }
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

export default {
  fetch: route
};