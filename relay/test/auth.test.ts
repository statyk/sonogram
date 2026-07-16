import { describe, it, expect } from 'vitest';
import {
  verifySignature,
  signingString,
  sha256hex,
  b64encode,
  REPLAY_WINDOW_MS,
} from '../src/auth';

async function makeKeypair() {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { pair, publicKeyB64: b64encode(raw) };
}

async function sign(
  privateKey: CryptoKey,
  agent: string,
  timestamp: string,
  method: string,
  pathWithQuery: string,
  body: Uint8Array,
): Promise<string> {
  const bodyHash = await sha256hex(body);
  const data = new TextEncoder().encode(signingString(agent, timestamp, method, pathWithQuery, bodyHash));
  return b64encode(new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, data)));
}

describe('verifySignature', () => {
  const body = new TextEncoder().encode('{"hello":"world"}');
  const ts = () => new Date().toISOString();

  it('accepts a valid signature', async () => {
    const { pair, publicKeyB64 } = await makeKeypair();
    const timestamp = ts();
    const signatureB64 = await sign(pair.privateKey, 'alice', timestamp, 'POST', '/send', body);
    const result = await verifySignature({
      agent: 'alice', publicKeyB64, signatureB64, timestamp, method: 'POST', pathWithQuery: '/send', body,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects a tampered body', async () => {
    const { pair, publicKeyB64 } = await makeKeypair();
    const timestamp = ts();
    const signatureB64 = await sign(pair.privateKey, 'alice', timestamp, 'POST', '/send', body);
    const result = await verifySignature({
      agent: 'alice', publicKeyB64, signatureB64, timestamp, method: 'POST', pathWithQuery: '/send',
      body: new TextEncoder().encode('{"hello":"tampered"}'),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('signature mismatch');
  });

  it('rejects a signature from a different key', async () => {
    const { pair } = await makeKeypair();
    const other = await makeKeypair();
    const timestamp = ts();
    const signatureB64 = await sign(pair.privateKey, 'alice', timestamp, 'GET', '/status', new Uint8Array());
    const result = await verifySignature({
      agent: 'alice', publicKeyB64: other.publicKeyB64, signatureB64, timestamp,
      method: 'GET', pathWithQuery: '/status', body: new Uint8Array(),
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a signature made for one agent presented as another (same key)', async () => {
    const { pair, publicKeyB64 } = await makeKeypair();
    const timestamp = ts();
    // Signed as 'alice' with this key…
    const signatureB64 = await sign(pair.privateKey, 'alice', timestamp, 'GET', '/status', new Uint8Array());
    // …replayed claiming to be 'bob' with the same key.
    const result = await verifySignature({
      agent: 'bob', publicKeyB64, signatureB64, timestamp,
      method: 'GET', pathWithQuery: '/status', body: new Uint8Array(),
    });
    expect(result.ok).toBe(false);
  });

  it('rejects timestamps outside the replay window', async () => {
    const { pair, publicKeyB64 } = await makeKeypair();
    const old = new Date(Date.now() - REPLAY_WINDOW_MS - 1000).toISOString();
    const signatureB64 = await sign(pair.privateKey, 'alice', old, 'GET', '/status', new Uint8Array());
    const result = await verifySignature({
      agent: 'alice', publicKeyB64, signatureB64, timestamp: old,
      method: 'GET', pathWithQuery: '/status', body: new Uint8Array(),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('replay window');
  });

  it('rejects garbage public keys and unparseable timestamps', async () => {
    const { pair, publicKeyB64 } = await makeKeypair();
    const timestamp = ts();
    const signatureB64 = await sign(pair.privateKey, 'alice', timestamp, 'GET', '/status', new Uint8Array());
    const badKey = await verifySignature({
      agent: 'alice', publicKeyB64: 'AAAA', signatureB64, timestamp,
      method: 'GET', pathWithQuery: '/status', body: new Uint8Array(),
    });
    expect(badKey.ok).toBe(false);
    const badTs = await verifySignature({
      agent: 'alice', publicKeyB64, signatureB64, timestamp: 'not-a-time',
      method: 'GET', pathWithQuery: '/status', body: new Uint8Array(),
    });
    expect(badTs.ok).toBe(false);
  });

  it('binds the signature to method and path', async () => {
    const { pair, publicKeyB64 } = await makeKeypair();
    const timestamp = ts();
    const signatureB64 = await sign(pair.privateKey, 'alice', timestamp, 'GET', '/read?target=a&since=0', new Uint8Array());
    const wrongPath = await verifySignature({
      agent: 'alice', publicKeyB64, signatureB64, timestamp,
      method: 'GET', pathWithQuery: '/read?target=b&since=0', body: new Uint8Array(),
    });
    expect(wrongPath.ok).toBe(false);
  });
});
