// Images on ai.chat messages, in exactly the shape Ollama's /api/chat takes
// them: messages[].images = base64 strings (no data: prefix). One pure
// validator for the tool broker, the Ollama adapter and the local AI client.
// The type and the dimensions are sniffed from the bytes; no field is trusted.
// Nothing here fetches anything: a node never follows a caller-named URL.
export const IMAGE_LIMITS = Object.freeze({
  max_per_request: 4,
  max_per_message: 4,
  max_bytes: 200_000,
  max_total_bytes: 600_000,
  max_side_px: 1600,
  max_pixels: 2_000_000
});
// 200,000 decoded bytes is 266,668 base64 characters; the catalog schema's maxLength.
export const MAX_IMAGE_BASE64_CHARS = Math.ceil(IMAGE_LIMITS.max_bytes / 3) * 4;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function refuse(code, message) {
  return Object.assign(new Error(message), { status: 400, code, retryable: false });
}

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Buffer.alloc(0);
}

export function sniffImageType(bytes) {
  const b = toBuffer(bytes);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function pngDimensions(b) {
  if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

// Walk the JPEG segments to the first frame header (SOF0..SOF15 except the
// DHT, JPG and DAC markers that share the range) and read height then width.
function jpegDimensions(b) {
  let offset = 2;
  while (offset + 3 < b.length) {
    if (b[offset] !== 0xff) return null;
    let marker = b[offset + 1];
    while (marker === 0xff && offset + 2 < b.length) { offset += 1; marker = b[offset + 1]; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { offset += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 3 >= b.length) return null;
    const length = b.readUInt16BE(offset + 2);
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (offset + 8 >= b.length) return null;
      return { width: b.readUInt16BE(offset + 7), height: b.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(b) {
  if (b.length < 25) return null;
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    if (b.length < 30) return null;
    return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return null;
}

export function imageDimensions(bytes, type = sniffImageType(bytes)) {
  const b = toBuffer(bytes);
  try {
    if (type === 'image/png') return pngDimensions(b);
    if (type === 'image/jpeg') return jpegDimensions(b);
    if (type === 'image/webp') return webpDimensions(b);
  } catch { return null; }
  return null;
}

export function hasImages(input) {
  const messages = input && typeof input === 'object' && Array.isArray(input.messages) ? input.messages : [];
  return messages.some((message) => Array.isArray(message?.images) && message.images.length > 0);
}

// Standard base64 only: no data: prefix, no whitespace, no URL-safe alphabet,
// correct padding, and the decoded length must match the string length.
export function decodeBase64Image(value, label = 'image') {
  if (typeof value !== 'string' || !value) throw refuse('AI_CHAT_IMAGE_INVALID', `${label} must be a base64 string`);
  if (value.startsWith('data:')) throw refuse('AI_CHAT_IMAGE_INVALID', `${label} must be bare base64 without a data: prefix`);
  if (value.length > MAX_IMAGE_BASE64_CHARS) throw refuse('AI_CHAT_IMAGE_TOO_LARGE', `${label} exceeds ${IMAGE_LIMITS.max_bytes} decoded bytes`);
  if (value.length % 4 !== 0 || !BASE64.test(value)) throw refuse('AI_CHAT_IMAGE_INVALID', `${label} is not standard base64`);
  const padding = value.endsWith('==') ? 2 : (value.endsWith('=') ? 1 : 0);
  const expected = (value.length / 4) * 3 - padding;
  const buffer = Buffer.from(value, 'base64');
  if (buffer.length !== expected) throw refuse('AI_CHAT_IMAGE_INVALID', `${label} decoded length mismatch`);
  return buffer;
}

export function validateChatImages(input, { maxPerRequest = IMAGE_LIMITS.max_per_request, maxPerMessage = IMAGE_LIMITS.max_per_message } = {}) {
  if (!input || typeof input !== 'object') return { images: 0, bytes: 0 };
  if (input.images !== undefined) throw refuse('AI_CHAT_IMAGE_INVALID', 'images belong on messages[]');
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const perRequest = Math.max(0, Math.min(IMAGE_LIMITS.max_per_request, Number(maxPerRequest) || 0));
  const perMessage = Math.max(0, Math.min(IMAGE_LIMITS.max_per_message, Number(maxPerMessage) || 0));
  let count = 0;
  let bytes = 0;
  messages.forEach((message, index) => {
    if (!message || typeof message !== 'object' || message.images === undefined || message.images === null) return;
    const label = `messages[${index}].images`;
    if (!Array.isArray(message.images)) throw refuse('AI_CHAT_IMAGE_INVALID', `${label} must be an array of base64 strings`);
    if (message.images.length > perMessage) throw refuse('AI_CHAT_IMAGES_TOO_MANY', `${label} carries ${message.images.length} images; at most ${perMessage} per message`);
    message.images.forEach((value, i) => {
      count += 1;
      if (count > perRequest) throw refuse('AI_CHAT_IMAGES_TOO_MANY', `at most ${perRequest} images per request`);
      const buffer = decodeBase64Image(value, `${label}[${i}]`);
      if (buffer.length > IMAGE_LIMITS.max_bytes) throw refuse('AI_CHAT_IMAGE_TOO_LARGE', `${label}[${i}] exceeds ${IMAGE_LIMITS.max_bytes} decoded bytes`);
      bytes += buffer.length;
      if (bytes > IMAGE_LIMITS.max_total_bytes) throw refuse('AI_CHAT_IMAGE_TOO_LARGE', `images exceed ${IMAGE_LIMITS.max_total_bytes} decoded bytes per request`);
      const type = sniffImageType(buffer);
      if (!type) throw refuse('AI_CHAT_IMAGE_TYPE', `${label}[${i}] is not a JPEG, PNG or WebP image`);
      const dimensions = imageDimensions(buffer, type);
      if (!dimensions) throw refuse('AI_CHAT_IMAGE_INVALID', `${label}[${i}] has an unreadable ${type} header`);
      if (dimensions.width > IMAGE_LIMITS.max_side_px || dimensions.height > IMAGE_LIMITS.max_side_px || dimensions.width * dimensions.height > IMAGE_LIMITS.max_pixels) {
        throw refuse('AI_CHAT_IMAGE_TOO_LARGE', `${label}[${i}] is ${dimensions.width}x${dimensions.height}; at most ${IMAGE_LIMITS.max_side_px} px a side and ${IMAGE_LIMITS.max_pixels} pixels`);
      }
    });
  });
  return { images: count, bytes };
}
