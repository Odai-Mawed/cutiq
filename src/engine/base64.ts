// Fast base64 for Uint8Array (Hermes has no Buffer).
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < ALPHA.length; i++) LOOKUP[ALPHA.charCodeAt(i)] = i;

export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk: string[] = [];
  const len = bytes.length;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    chunk.push(ALPHA[n >> 18] + ALPHA[(n >> 12) & 63] + ALPHA[(n >> 6) & 63] + ALPHA[n & 63]);
    if (chunk.length === 4096) {
      parts.push(chunk.join(''));
      chunk = [];
    }
  }
  if (i < len) {
    const n = (bytes[i] << 16) | ((i + 1 < len ? bytes[i + 1] : 0) << 8);
    chunk.push(ALPHA[n >> 18] + ALPHA[(n >> 12) & 63] + (i + 1 < len ? ALPHA[(n >> 6) & 63] : '=') + '=');
  }
  parts.push(chunk.join(''));
  return parts.join('');
}

export function decodeBase64(b64: string): Uint8Array {
  let len = b64.length;
  while (len > 0 && b64[len - 1] === '=') len--;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  let i = 0;
  for (; i + 3 < len; i += 4) {
    const n =
      (LOOKUP[b64.charCodeAt(i)] << 18) |
      (LOOKUP[b64.charCodeAt(i + 1)] << 12) |
      (LOOKUP[b64.charCodeAt(i + 2)] << 6) |
      LOOKUP[b64.charCodeAt(i + 3)];
    out[o++] = n >> 16;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }
  const rest = len - i;
  if (rest >= 2) {
    const n = (LOOKUP[b64.charCodeAt(i)] << 18) | (LOOKUP[b64.charCodeAt(i + 1)] << 12) | (rest === 3 ? LOOKUP[b64.charCodeAt(i + 2)] << 6 : 0);
    out[o++] = n >> 16;
    if (rest === 3) out[o++] = (n >> 8) & 255;
  }
  return out;
}
