#!/usr/bin/env node
// Reproducible, dependency-free ZIP packaging of the reviewed device runtime.
// Run from any directory; output is build material, not a production deployment.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { runtimeBundle } from '../core/macos/mccluster-node.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MAC_ARCHIVE_NAME = 'mccluster-macos-worker.zip';
export const MAC_ARCHIVE_ROOT = 'mccluster-macos-worker';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP32, UTF-8 paths, DEFLATE, fixed 1980 timestamp and private file modes. */
export function deterministicZip(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 65535) throw new Error('Invalid archive entry count.');
  const files = [], directory = [], seen = new Set();
  let offset = 0;
  for (const { name, bytes } of [...entries].sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(name) || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..') || seen.has(name)) throw new Error('Unsafe or duplicate archive path.');
    seen.add(name);
    const filename = Buffer.from(name, 'utf8');
    const content = Buffer.from(bytes);
    const compressed = deflateRawSync(content, { level: 9 });
    if (filename.length > 65535 || content.length > 0xffffffff || offset > 0xffffffff) throw new Error('Archive exceeds ZIP32 limits.');
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(filename.length, 26);
    files.push(local, filename, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x314, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt32LE((0o100600 << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    directory.push(central, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const centralBytes = Buffer.concat(directory);
  if (offset + centralBytes.length > 0xffffffff) throw new Error('Archive exceeds ZIP32 limits.');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, centralBytes, end]);
}

export async function packageMacosWorker({ outputDir = path.join(ROOT, 'downloads'), coreRoot = path.join(ROOT, 'core') } = {}) {
  const bundle = await runtimeBundle(coreRoot);
  const entries = [...bundle.files].map(([name, bytes]) => ({ name: `${MAC_ARCHIVE_ROOT}/core/${name.split(path.sep).join('/')}`, bytes }));
  entries.push({ name: `${MAC_ARCHIVE_ROOT}/README.txt`, bytes: Buffer.from(`McCluster Mac worker\n\nThis package contains the reviewed Mac installer and the existing device-agent\nand Ollama-adapter runtime. It contains no credentials, device keys or config.\n\nRequirements: Apple silicon Mac, Node.js 20 or later, owner-installed Ollama,\nand qwen3:8b installed locally. The installer does not download either program\nor the model. Run 'ollama pull qwen3:8b' yourself before enrollment.\n\nDownload mccluster-device-setup.json from the signed-in owner's Devices panel.\nOpen Terminal in the directory holding that file and the extracted package:\n\nnode mccluster-macos-worker/core/macos/mccluster-node.mjs install --setup-file ./mccluster-device-setup.json\n\nPaste the short-lived one-use credential only at the hidden prompt. Do not put\nit in a command, URL, environment variable, setup file, chat, screenshot or log.\nThe installer generates the private device key locally and enrolls over HTTPS.\n\nThe default is qwen3:8b, one active lease and 4096 context. Model capability is\nwithheld until a local benchmark passes. Keep Ollama bound to loopback.\n\nFor a no-write plan, add --dry-run to the install command.\nFor commands, replace 'install --setup-file ...' with 'help'.\n\nThis package has not been verified on a physical Mac in this build session.\nShared-model EXO pairs are not installed or enabled by this package.\n\nRuntime bundle SHA256: ${bundle.digest}\n`, 'utf8') });
  const bytes = deterministicZip(entries);
  const digest = sha256(bytes);
  const manifest = { schema: 'mccluster-macos-worker-package/1', filename: MAC_ARCHIVE_NAME,
    archive_root: MAC_ARCHIVE_ROOT, sha256: digest, bytes: bytes.length,
    runtime_sha256: bundle.digest, model: 'qwen3:8b', implementation: 'qwen3.8b.local',
    context: 4096, max_leases: 1, required_node_major: 20,
    setup_command: 'node mccluster-macos-worker/core/macos/mccluster-node.mjs install --setup-file ./mccluster-device-setup.json',
    credential_input: 'hidden-terminal-stdin', physical_mac_verified: false,
    files: entries.map(entry => ({ path: entry.name, bytes: entry.bytes.length, sha256: sha256(entry.bytes) })).sort((a, b) => a.path.localeCompare(b.path, 'en')) };
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, MAC_ARCHIVE_NAME), bytes);
  await fs.writeFile(path.join(outputDir, 'mccluster-macos-worker.sha256'), `${digest}  ${MAC_ARCHIVE_NAME}\n`);
  await fs.writeFile(path.join(outputDir, 'mccluster-macos-worker.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...manifest, output_dir: path.resolve(outputDir) };
}

async function main(argv) {
  if (argv.length && (argv.length !== 2 || argv[0] !== '--output-dir')) throw new Error('Usage: node scripts/package-macos-worker.mjs [--output-dir <directory>]');
  const result = await packageMacosWorker(argv.length ? { outputDir: path.resolve(argv[1]) } : {});
  console.log(JSON.stringify({ filename: result.filename, output_dir: result.output_dir, sha256: result.sha256,
    bytes: result.bytes, runtime_sha256: result.runtime_sha256, files: result.files.length }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
