export const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export function b64encode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function signingString(
  agent: string,
  timestamp: string,
  method: string,
  pathWithQuery: string,
  bodyHashHex: string,
): string {
  return `${agent}\n${timestamp}\n${method.toUpperCase()}\n${pathWithQuery}\n${bodyHashHex}`;
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
}

export async function verifySignature(opts: {
  agent: string;
  publicKeyB64: string;
  signatureB64: string;
  timestamp: string;
  method: string;
  pathWithQuery: string;
  body: Uint8Array;
  now?: number;
}): Promise<VerifyResult> {
  const ts = Date.parse(opts.timestamp);
  if (Number.isNaN(ts)) return { ok: false, error: 'unparseable timestamp' };
  const now = opts.now ?? Date.now();
  if (Math.abs(now - ts) > REPLAY_WINDOW_MS) {
    return { ok: false, error: 'timestamp outside replay window (check your system clock)' };
  }
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'raw',
      b64decode(opts.publicKeyB64) as BufferSource,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
  } catch {
    return { ok: false, error: 'invalid public key' };
  }
  let sig: Uint8Array;
  try {
    sig = b64decode(opts.signatureB64);
  } catch {
    return { ok: false, error: 'invalid signature encoding' };
  }
  const bodyHash = await sha256hex(opts.body);
  const data = new TextEncoder().encode(
    signingString(opts.agent, opts.timestamp, opts.method, opts.pathWithQuery, bodyHash),
  );
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify('Ed25519', key, sig as BufferSource, data as BufferSource);
  } catch {
    return { ok: false, error: 'invalid signature' };
  }
  return valid ? { ok: true } : { ok: false, error: 'signature mismatch' };
}
