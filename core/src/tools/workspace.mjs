import path from 'node:path';
import { mkdir, readdir, readFile, writeFile, rename, lstat, stat } from 'node:fs/promises';

const ROOT = path.resolve(process.env.MCCLUSTER_HOME_ROOT || path.join(process.env.HOME || '/var/lib/mccluster-core', 'home'));
const MAX_FILE_BYTES = Math.max(16 * 1024, Math.min(4 * 1024 * 1024, Number(process.env.MCCLUSTER_HOME_MAX_FILE_BYTES || 1024 * 1024)));
const STANDARD_DIRS = Object.freeze(['notes', 'artifacts', 'scratch', 'state', 'inbox', 'outbox']);

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function cleanRelative(value, { allowRoot = true } = {}) {
  const raw = String(value ?? '').trim().replace(/\\/g, '/');
  if (!raw) {
    if (allowRoot) return '';
    fail('workspace path is required');
  }
  if (raw.includes('\0') || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) fail('workspace path must be relative');
  const normalized = path.posix.normalize(raw).replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../')) fail('workspace path escapes McCluster home');
  if (normalized === '.' && allowRoot) return '';
  if (normalized.length > 500) fail('workspace path is too long');
  return normalized;
}

function targetFor(relative) {
  const resolved = path.resolve(ROOT, relative || '.');
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) fail('workspace path escapes McCluster home');
  return resolved;
}

async function ensureHome() {
  await mkdir(ROOT, { recursive: true, mode: 0o700 });
  await Promise.all(STANDARD_DIRS.map((name) => mkdir(path.join(ROOT, name), { recursive: true, mode: 0o700 })));
}

async function assertNoSymlink(relative, { allowMissingFinal = false } = {}) {
  const parts = relative ? relative.split('/').filter(Boolean) : [];
  let current = ROOT;
  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i]);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) fail('workspace symlinks are not allowed', 403);
    } catch (error) {
      if (error?.code === 'ENOENT' && allowMissingFinal) return;
      throw error;
    }
  }
}

async function summary() {
  await ensureHome();
  const entries = await readdir(ROOT, { withFileTypes: true });
  return {
    root: ROOT,
    persistent: true,
    max_file_bytes: MAX_FILE_BYTES,
    standard_directories: STANDARD_DIRS,
    entries: entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'
    })).sort((a, b) => a.name.localeCompare(b.name))
  };
}

export async function workspaceStatus() {
  return {
    schema: 'mccluster-workspace/v1',
    ...(await summary()),
    purpose: 'Persistent McCluster-owned working files on the OVH Core host. Conversation truth remains in Supabase; disposable code worktrees remain under /srv/mccluster/worktrees.'
  };
}

export async function workspaceList({ path: requested = '' } = {}) {
  await ensureHome();
  const relative = cleanRelative(requested);
  await assertNoSymlink(relative);
  const target = targetFor(relative);
  const info = await stat(target).catch((error) => {
    if (error?.code === 'ENOENT') fail('workspace path not found', 404);
    throw error;
  });
  if (!info.isDirectory()) fail('workspace list target is not a directory');
  const entries = await readdir(target, { withFileTypes: true });
  const rows = await Promise.all(entries.slice(0, 500).map(async (entry) => {
    const childRel = relative ? relative + '/' + entry.name : entry.name;
    const child = targetFor(childRel);
    const childInfo = await lstat(child);
    return {
      name: entry.name,
      path: childRel,
      type: childInfo.isSymbolicLink() ? 'symlink-blocked' : childInfo.isDirectory() ? 'directory' : childInfo.isFile() ? 'file' : 'other',
      size: childInfo.isFile() ? childInfo.size : null,
      modified_at: childInfo.mtime?.toISOString?.() || null
    };
  }));
  return { schema: 'mccluster-workspace-list/v1', path: relative, entries: rows };
}

export async function workspaceRead({ path: requested } = {}) {
  await ensureHome();
  const relative = cleanRelative(requested, { allowRoot: false });
  await assertNoSymlink(relative);
  const target = targetFor(relative);
  const info = await stat(target).catch((error) => {
    if (error?.code === 'ENOENT') fail('workspace file not found', 404);
    throw error;
  });
  if (!info.isFile()) fail('workspace read target is not a file');
  if (info.size > MAX_FILE_BYTES) fail('workspace file exceeds read limit', 413);
  const content = await readFile(target, 'utf8');
  return {
    schema: 'mccluster-workspace-file/v1',
    path: relative,
    size: Buffer.byteLength(content, 'utf8'),
    modified_at: info.mtime?.toISOString?.() || null,
    content
  };
}

export async function workspaceWrite({ path: requested, content } = {}) {
  await ensureHome();
  const relative = cleanRelative(requested, { allowRoot: false });
  if (typeof content !== 'string') fail('workspace content must be a string');
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_FILE_BYTES) fail('workspace file exceeds write limit', 413);

  const parts = relative.split('/');
  const filename = parts.pop();
  const parentRel = parts.join('/');
  const parent = targetFor(parentRel);
  await assertNoSymlink(parentRel, { allowMissingFinal: true });
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await assertNoSymlink(parentRel);

  const target = targetFor(relative);
  try {
    const existing = await lstat(target);
    if (existing.isSymbolicLink()) fail('workspace symlinks are not allowed', 403);
    if (!existing.isFile()) fail('workspace write target is not a regular file');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const temp = path.join(parent, '.' + filename + '.tmp-' + process.pid + '-' + Date.now());
  await writeFile(temp, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temp, target);
  const info = await stat(target);
  return {
    schema: 'mccluster-workspace-file/v1',
    path: relative,
    size: info.size,
    modified_at: info.mtime?.toISOString?.() || null,
    written: true
  };
}

export const WORKSPACE_TOOLS = Object.freeze([
  {
    name: 'core.workspace.status',
    title: 'Inspect McCluster home',
    description: 'Read the persistent McCluster VPS workspace contract and top-level directories.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'core.workspace.list',
    title: 'List McCluster home',
    description: 'List one directory inside the persistent McCluster VPS workspace.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'core.workspace.read',
    title: 'Read McCluster home file',
    description: 'Read one bounded UTF-8 file inside the persistent McCluster VPS workspace.',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } }, additionalProperties: false }
  },
  {
    name: 'core.workspace.write',
    title: 'Write McCluster home file',
    description: 'Atomically write one bounded UTF-8 file inside the persistent McCluster VPS workspace. Cannot escape the workspace or traverse symlinks.',
    inputSchema: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } }, additionalProperties: false }
  }
]);

export async function callWorkspaceTool(name, args = {}) {
  if (name === 'core.workspace.status') return workspaceStatus();
  if (name === 'core.workspace.list') return workspaceList(args);
  if (name === 'core.workspace.read') return workspaceRead(args);
  if (name === 'core.workspace.write') return workspaceWrite(args);
  fail('unknown workspace tool', 404);
}
