import path from 'node:path';
import { lstat, readdir, realpath, copyFile, mkdir } from 'node:fs/promises';

export const PREVIEW_ROOT = process.env.MCCLUSTER_PREVIEW_ROOT || '/var/lib/mccluster-core/previews';
export const PUBLIC_BASE = String(process.env.MCCLUSTER_PREVIEW_PUBLIC_BASE || '').replace(/\/+$/, '');
export const SLUG = /^[a-z0-9][a-z0-9-]{0,71}$/;
export function previewConfigured() {
  try {
    const u = new URL(PUBLIC_BASE);
    return process.env.MCCLUSTER_PREVIEW_ENABLED === '1' && u.protocol === 'https:'
      && !u.username && !u.password && !u.search && !u.hash;
  } catch { return false; }
}
export function relativeDirectory(value = '.') {
  if (typeof value !== 'string' || value.includes('\0') || value.includes('\\')
    || path.isAbsolute(value) || value.split('/').includes('..')) throw new Error('preview directory must stay inside repository');
  return value || '.';
}
export async function confinedPath(root, relative = '.') {
  relativeDirectory(relative);
  const base = await realpath(root);
  let cursor = base;
  for (const part of relative.split('/').filter(p => p && p !== '.')) {
    cursor = path.join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Preview symbolic links are forbidden');
  }
  const resolved = await realpath(cursor);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('Preview path escaped root');
  return resolved;
}
const ASSETS = new Set(['.html','.css','.js','.mjs','.json','.svg','.png','.jpg','.jpeg','.gif','.webp','.ico',
  '.txt','.xml','.pdf','.woff','.woff2','.ttf','.otf','.wasm','.mp3','.wav','.ogg','.mp4','.webm','.glb','.gltf','.bin']);
const PRIVATE = /(?:secret|credential|private[-_]?key|id_rsa|id_ed25519)/i;
export function publicAsset(parts) {
  return parts.every(p => !p.startsWith('.') && !PRIVATE.test(p) && !['node_modules','package.json','package-lock.json','metadata.json'].includes(p))
    && ASSETS.has(path.extname(parts.at(-1)).toLowerCase());
}
export async function publishAssets(source, destination, { maxBytes = 100 * 1024 * 1024, maxFiles = 10000 } = {}) {
  let bytes = 0, files = 0;
  async function walk(parts = []) {
    for (const entry of await readdir(path.join(source, ...parts), { withFileTypes: true })) {
      const next = [...parts, entry.name];
      const file = path.join(source, ...next);
      const info = await lstat(file);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error('Preview output contains an unsafe file');
      if (entry.name.startsWith('.') || PRIVATE.test(entry.name) || entry.name === 'node_modules') continue;
      if (info.isDirectory()) { await walk(next); continue; }
      if (!publicAsset(next)) continue;
      files += 1; bytes += info.size;
      if (files > maxFiles || bytes > maxBytes) throw new Error('Preview exceeds publication limits');
      const target = path.join(destination, ...next);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(file, target);
    }
  }
  await walk();
  return { files, bytes };
}

export async function rejectBuildSymlinks(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new Error('Preview build contains a symbolic link');
    if (info.isDirectory()) await rejectBuildSymlinks(file);
  }
}
