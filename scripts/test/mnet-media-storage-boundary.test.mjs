import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalMediaUploader } from '../../supabase/functions/mnet-media/storage-path.mjs';

const A = '11111111-1111-4111-8111-111111111111';
const OBJECT = '22222222-2222-4222-8222-222222222222';
const bound = { bucket_id: 'mnet-media', object_path: A + '/' + OBJECT + '-avatar.png' };

test('valid signed-upload object paths preserve their canonical uploader identity', () => {
  assert.equal(canonicalMediaUploader(bound), A);
  assert.equal(canonicalMediaUploader({ ...bound, object_path: A.toUpperCase() + '/' + OBJECT + '-MUSIC-1.mp4' }), A);
});

test('metadata cannot re-target arbitrary private buckets or foreign storage key layouts', () => {
  const illegal = [
    { ...bound, bucket_id: 'mcc-gated-audio' },
    { ...bound, bucket_id: 'any-other-bucket' },
    { ...bound, object_path: 'other/file' },
    { ...bound, object_path: A + '/../private.mp3' },
    { ...bound, object_path: A + '/' + OBJECT + '-file/name.mp3' },
    { ...bound, object_path: A + '/' + OBJECT + '-file%2fprivate.mp3' },
    { ...bound, object_path: 'https://example.test/object' },
    { ...bound, object_path: A + '/' + OBJECT + '-' },
  ];
  for (const asset of illegal) assert.equal(canonicalMediaUploader(asset), null, JSON.stringify(asset));
});

test('every privileged storage action verifies uploader-to-M identity binding', async () => {
  const source = await readFile(new URL('../../supabase/functions/mnet-media/index.ts', import.meta.url), 'utf8');
  assert.match(source, /eq\("auth_user_id",uploader\)\.eq\("m_uid",asset\.owner_m_uid\)/);
  assert.match(source, /if\(!visible\|\|!\(await storageBelongsToAsset\(asset\)\)\)/);
  assert.match(source, /if\(!\(await storageBelongsToAsset\(asset\)\)\)return json\(\{error:"asset storage binding invalid"\},409\)/);
  assert.equal((source.match(/if\(!\(await storageBelongsToAsset\(asset\)\)\)/g)||[]).length,2,
    'discard and finalize must check ownership before storage mutation');
});
