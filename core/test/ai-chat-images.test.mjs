// Images on ai.chat messages, exactly as Ollama takes them (messages[].images
// as base64): one pure validator shared by the tool broker, the Ollama adapter
// and the local AI client. Types and dimensions are sniffed from the bytes,
// never trusted from a field, and every bound is proven to fit today's body
// limits by arithmetic rather than by raising them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_LIMITS, MAX_IMAGE_BASE64_CHARS, hasImages, imageDimensions, sniffImageType, validateChatImages
} from '../src/compute/ai-chat-images.mjs';

// Hand-built headers: the validator reads headers only, so a header with a
// zero-byte body is a complete test image for sniffing and bounds.
export function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const length = Buffer.alloc(4); length.writeUInt32BE(13, 0);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), length, Buffer.from('IHDR'), ihdr, Buffer.alloc(4)]);
}
export function jpeg(width, height, { marker = 0xc0, extraSegments = [], fill = false } = {}) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff; sof[1] = marker; sof.writeUInt16BE(17, 2); sof[4] = 8;
  sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7); sof[9] = 3;
  sof.set([0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01], 10);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, ...extraSegments, ...(fill ? [Buffer.from([0xff, 0xff])] : []), sof, Buffer.from([0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])]);
}
export function webp(width, height, kind = 'VP8 ') {
  let chunk;
  if (kind === 'VP8 ') {
    chunk = Buffer.alloc(10);
    chunk.set([0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a], 0);
    chunk.writeUInt16LE(width & 0x3fff, 6); chunk.writeUInt16LE(height & 0x3fff, 8);
  } else if (kind === 'VP8L') {
    chunk = Buffer.alloc(5);
    chunk[0] = 0x2f;
    chunk.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 1);
  } else {
    chunk = Buffer.alloc(10);
    chunk.writeUIntLE(width - 1, 4, 3); chunk.writeUIntLE(height - 1, 7, 3);
  }
  const header = Buffer.alloc(8); header.write(kind, 0, 'latin1'); header.writeUInt32LE(chunk.length, 4);
  const riffSize = Buffer.alloc(4); riffSize.writeUInt32LE(4 + header.length + chunk.length, 0);
  return Buffer.concat([Buffer.from('RIFF'), riffSize, Buffer.from('WEBP'), header, chunk]);
}
const b64 = (buffer) => buffer.toString('base64');
const message = (...images) => ({ messages: [{ role: 'user', content: 'what is this', images }] });
// A real 1x1 PNG, so the sniffer is proven on a genuine file too.
const REAL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('the limits are the designed ones and the base64 ceiling follows from the byte cap', () => {
  assert.deepEqual(IMAGE_LIMITS, { max_per_request: 4, max_per_message: 4, max_bytes: 200_000, max_total_bytes: 600_000, max_side_px: 1600, max_pixels: 2_000_000 });
  assert.equal(MAX_IMAGE_BASE64_CHARS, 266_668, 'ceil(200000 / 3) * 4');
});

test('types are sniffed from magic bytes, never from a field', () => {
  assert.equal(sniffImageType(jpeg(10, 10)), 'image/jpeg');
  assert.equal(sniffImageType(png(10, 10)), 'image/png');
  assert.equal(sniffImageType(Buffer.from(REAL_PNG, 'base64')), 'image/png');
  assert.equal(sniffImageType(webp(10, 10)), 'image/webp');
  assert.equal(sniffImageType(Buffer.from('GIF89a')), null);
  assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(sniffImageType(Buffer.alloc(0)), null);
  assert.equal(sniffImageType(Buffer.from('RIFF\0\0\0\0WAVE')), null, 'RIFF alone is not WebP');
});

test('dimensions come from the header: PNG IHDR, JPEG SOFn (baseline and progressive, past fill bytes and other segments), WebP VP8/VP8L/VP8X', () => {
  assert.deepEqual(imageDimensions(png(1280, 800)), { width: 1280, height: 800 });
  assert.deepEqual(imageDimensions(Buffer.from(REAL_PNG, 'base64')), { width: 1, height: 1 });
  assert.deepEqual(imageDimensions(jpeg(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(imageDimensions(jpeg(300, 200, { marker: 0xc2 })), { width: 300, height: 200 }, 'progressive SOF2');
  const dht = Buffer.from([0xff, 0xc4, 0x00, 0x05, 0x00, 0x01, 0x02]);
  const com = Buffer.from([0xff, 0xfe, 0x00, 0x04, 0x68, 0x69]);
  assert.deepEqual(imageDimensions(jpeg(123, 45, { extraSegments: [dht, com], fill: true })), { width: 123, height: 45 }, 'DHT is not a SOF marker; fill bytes are skipped');
  assert.deepEqual(imageDimensions(webp(1024, 768, 'VP8 ')), { width: 1024, height: 768 });
  assert.deepEqual(imageDimensions(webp(1600, 900, 'VP8L')), { width: 1600, height: 900 });
  assert.deepEqual(imageDimensions(webp(2000, 1500, 'VP8X')), { width: 2000, height: 1500 });
  assert.equal(imageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), null, 'a JPEG without a frame header has no dimensions');
  assert.equal(imageDimensions(png(1, 1).subarray(0, 20)), null, 'a truncated IHDR has no dimensions');
  assert.equal(imageDimensions(Buffer.from('not an image')), null);
});

test('hasImages is true only for a non-empty images array on some message', () => {
  assert.equal(hasImages(message(b64(png(1, 1)))), true);
  assert.equal(hasImages({ messages: [{ role: 'user', content: 'x', images: [] }] }), false);
  assert.equal(hasImages({ messages: [{ role: 'user', content: 'x' }] }), false);
  assert.equal(hasImages({ prompt: 'x' }), false);
  assert.equal(hasImages({ prompt: 'x', images: ['abc='] }), false, 'top-level images are not a message image (they are refused by the validator)');
  assert.equal(hasImages(null), false);
});

test('valid images pass and are counted; the prompt form and a top-level images field are refused', () => {
  const one = validateChatImages(message(b64(png(100, 50))));
  assert.deepEqual(one, { images: 1, bytes: png(100, 50).length });
  const two = validateChatImages({ messages: [{ role: 'user', content: 'a', images: [b64(jpeg(10, 10))] }, { role: 'tool', content: 'b', images: [b64(webp(10, 10)), REAL_PNG] }] });
  assert.equal(two.images, 3);
  assert.deepEqual(validateChatImages({ prompt: 'no images here' }), { images: 0, bytes: 0 });
  assert.deepEqual(validateChatImages({ messages: [{ role: 'user', content: 'x', images: [] }] }), { images: 0, bytes: 0 });
  assert.throws(() => validateChatImages({ prompt: 'x', images: [b64(png(1, 1))] }), (error) => error.code === 'AI_CHAT_IMAGE_INVALID' && error.status === 400 && error.retryable === false && /messages\[\]/.test(error.message));
  assert.throws(() => validateChatImages({ messages: [{ role: 'user', content: 'x', images: 'not-an-array' }] }), (error) => error.code === 'AI_CHAT_IMAGE_INVALID');
  assert.throws(() => validateChatImages({ messages: [{ role: 'user', content: 'x', images: [42] }] }), (error) => error.code === 'AI_CHAT_IMAGE_INVALID');
});

test('base64 is standard, padded and bare: a data: prefix, whitespace, URL-safe alphabet or a length mismatch is AI_CHAT_IMAGE_INVALID', () => {
  const good = b64(png(2, 2));
  for (const bad of [`data:image/png;base64,${good}`, `${good.slice(0, 10)}\n${good.slice(10)}`, good.replace(/\+/g, '-').replace(/\//g, '_') + '-_', good.slice(0, good.length - 1), '', 'A===', '%%%%']) {
    assert.throws(() => validateChatImages(message(bad)), (error) => error.code === 'AI_CHAT_IMAGE_INVALID' && error.status === 400, `expected AI_CHAT_IMAGE_INVALID for ${JSON.stringify(bad.slice(0, 20))}`);
  }
});

test('type and size bounds: unknown bytes, too many, too large by bytes, by total, by side or by pixel count', () => {
  assert.throws(() => validateChatImages(message(Buffer.from('GIF89a plus some bytes').toString('base64'))), (error) => error.code === 'AI_CHAT_IMAGE_TYPE' && error.status === 400);
  const small = b64(png(1, 1));
  assert.throws(() => validateChatImages(message(small, small, small, small, small)), (error) => error.code === 'AI_CHAT_IMAGES_TOO_MANY', 'five on one message');
  assert.throws(() => validateChatImages({ messages: [{ role: 'user', content: 'a', images: [small, small, small] }, { role: 'user', content: 'b', images: [small, small] }] }), (error) => error.code === 'AI_CHAT_IMAGES_TOO_MANY', 'five across messages');
  assert.throws(() => validateChatImages(message(small, small), { maxPerRequest: 1 }), (error) => error.code === 'AI_CHAT_IMAGES_TOO_MANY', 'a caller may lower the request cap');
  const oversize = Buffer.concat([png(10, 10), Buffer.alloc(IMAGE_LIMITS.max_bytes)]);
  assert.throws(() => validateChatImages(message(b64(oversize))), (error) => error.code === 'AI_CHAT_IMAGE_TOO_LARGE');
  const atCap = Buffer.concat([png(10, 10), Buffer.alloc(IMAGE_LIMITS.max_bytes - png(10, 10).length)]);
  assert.equal(atCap.length, IMAGE_LIMITS.max_bytes);
  assert.equal(validateChatImages(message(b64(atCap))).bytes, IMAGE_LIMITS.max_bytes, 'exactly the cap passes');
  assert.throws(() => validateChatImages(message(b64(atCap), b64(atCap), b64(atCap), b64(atCap))), (error) => error.code === 'AI_CHAT_IMAGE_TOO_LARGE', 'four at the cap exceed the 600 KB total');
  assert.equal(validateChatImages(message(b64(atCap), b64(atCap), b64(atCap))).bytes, 600_000, 'three at the cap are exactly the total');
  assert.throws(() => validateChatImages(message(b64(png(1601, 10)))), (error) => error.code === 'AI_CHAT_IMAGE_TOO_LARGE', 'width over 1600');
  assert.throws(() => validateChatImages(message(b64(png(10, 1601)))), (error) => error.code === 'AI_CHAT_IMAGE_TOO_LARGE', 'height over 1600');
  assert.throws(() => validateChatImages(message(b64(png(1600, 1300)))), (error) => error.code === 'AI_CHAT_IMAGE_TOO_LARGE', '2,080,000 pixels');
  assert.equal(validateChatImages(message(b64(png(1600, 1250)))).images, 1, '2,000,000 pixels exactly passes');
  assert.throws(() => validateChatImages(message(b64(jpeg(1, 1).subarray(0, 6)))), (error) => error.code === 'AI_CHAT_IMAGE_INVALID', 'an unreadable header is invalid, not accepted');
});

test('a PNG that claims to be a JPEG is typed by its bytes, and the type never comes from a mime field', () => {
  const result = validateChatImages({ messages: [{ role: 'user', content: 'x', images: [b64(png(4, 4))], mime: 'image/jpeg' }] });
  assert.equal(result.images, 1);
  assert.equal(sniffImageType(png(4, 4)), 'image/png');
});

test('worst case fits: every bound stays inside the body limits that exist today', () => {
  const EDGE_AND_BROKER = 1_048_576;      // workers/mccluster-mcp MAX_BODY and tool-broker BODY_LIMIT
  const GATEWAY = 2_097_152;              // CORE_COMPUTE_BODY_LIMIT and requestJson maxBytes
  const EXECUTOR_READ = 1_500_000;        // node-agent readBoundedText on the executor answer
  const TEXT = 12_000;                    // core.ai.turn.submit content maxLength
  const perImage = MAX_IMAGE_BASE64_CHARS + 4; // quotes, comma and brackets
  assert.ok(4 * perImage + TEXT < GATEWAY, 'four images at the per-image cap plus the text fit the gateway and the lease read');
  const totalCap = Math.ceil(IMAGE_LIMITS.max_total_bytes / 3) * 4;
  assert.equal(totalCap, 800_000);
  assert.ok(totalCap + 4 * 4 + TEXT < EDGE_AND_BROKER, 'the 600 KB total cap plus the text fits the 1 MiB edge and broker bodies');
  assert.ok(2 * perImage + TEXT < EDGE_AND_BROKER, 'two chat images (the turn cap) fit the edge and the broker');
  assert.ok(2 * perImage + 20_000 < GATEWAY, 'two screenshots on an observation plus page text fit the gateway');
  assert.ok(1_000_000 < EXECUTOR_READ, 'the browser.act output cap stays under the executor read limit');
  assert.ok(1_200_000 + 2 * perImage < 4_000_000, 'the persisted metadata cap is a bounded row, not an unbounded one');
});
