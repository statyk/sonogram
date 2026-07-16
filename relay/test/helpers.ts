import { SELF } from 'cloudflare:test';
import { b64encode, sha256hex, signingString } from '../src/auth';
import { OWNER_JWK_X, OWNER_JWK_D } from './fixtures';

export const OWNER_NAME = 'owner';

export async function importPrivateJwk(x: string, d: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'Ed25519', x, d },
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
}

export async function ownerKey(): Promise<CryptoKey> {
  return importPrivateJwk(OWNER_JWK_X, OWNER_JWK_D);
}

export async function signedHeaders(
  agent: string,
  privateKey: CryptoKey,
  method: string,
  pathWithQuery: string,
  body = '',
): Promise<Record<string, string>> {
  const timestamp = new Date().toISOString();
  const bodyHash = await sha256hex(new TextEncoder().encode(body));
  const data = new TextEncoder().encode(signingString(agent, timestamp, method, pathWithQuery, bodyHash));
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, data));
  return {
    'x-sonogram-agent': agent,
    'x-sonogram-timestamp': timestamp,
    'x-sonogram-signature': b64encode(sig),
  };
}

export async function signedFetch(
  agent: string,
  privateKey: CryptoKey,
  method: string,
  pathWithQuery: string,
  body = '',
): Promise<Response> {
  const headers = await signedHeaders(agent, privateKey, method, pathWithQuery, body);
  return SELF.fetch(`https://relay${pathWithQuery}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : body,
  });
}

export async function ownerFetch(method: string, pathWithQuery: string, body = ''): Promise<Response> {
  return signedFetch(OWNER_NAME, await ownerKey(), method, pathWithQuery, body);
}

export interface TestAgent {
  name: string;
  privateKey: CryptoKey;
  publicKeyB64: string;
  fetch: (method: string, pathWithQuery: string, body?: string) => Promise<Response>;
}

/** Generates a keypair, has the owner mint an invite, registers the agent. */
export async function createAgent(name: string): Promise<TestAgent> {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKeyB64 = b64encode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));

  const inviteBody = JSON.stringify({ name });
  const invRes = await ownerFetch('POST', '/admin/invite', inviteBody);
  if (invRes.status !== 200) throw new Error(`invite failed: ${invRes.status}`);
  const { invite_code } = (await invRes.json()) as { invite_code: string };

  const regBody = JSON.stringify({ invite_code, name, public_key: publicKeyB64 });
  const regRes = await SELF.fetch('https://relay/register', { method: 'POST', body: regBody });
  const regStatus = regRes.status;
  await regRes.text();
  if (regStatus !== 200) throw new Error(`register failed: ${regStatus}`);

  return {
    name,
    privateKey: pair.privateKey,
    publicKeyB64,
    fetch: (method, pathWithQuery, body = '') =>
      signedFetch(name, pair.privateKey, method, pathWithQuery, body),
  };
}
