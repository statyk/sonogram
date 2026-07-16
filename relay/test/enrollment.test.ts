import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { b64encode } from '../src/auth';
import { ownerFetch, createAgent } from './helpers';

async function freshPubkey(): Promise<string> {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
  return b64encode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
}

describe('enrollment', () => {
  it('owner invites, friend registers, friend can call /status', async () => {
    const radio = await createAgent('radio');
    const res = await radio.fetch('GET', '/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.agent).toBe('radio');
    expect(body.is_owner).toBe(false);
  });

  it('rejects invite creation by non-owners', async () => {
    const radio = await createAgent('radio');
    const res = await radio.fetch('POST', '/admin/invite', JSON.stringify({ name: 'mole' }));
    expect(res.status).toBe(403);
    await res.text();
  });

  it('rejects an invite code that was already redeemed', async () => {
    const invRes = await ownerFetch('POST', '/admin/invite', JSON.stringify({ name: 'radio' }));
    const { invite_code } = (await invRes.json()) as any;
    const reg1 = await SELF.fetch('https://relay/register', {
      method: 'POST',
      body: JSON.stringify({ invite_code, name: 'radio', public_key: await freshPubkey() }),
    });
    expect(reg1.status).toBe(200);
    await reg1.text();
    const reg2 = await SELF.fetch('https://relay/register', {
      method: 'POST',
      body: JSON.stringify({ invite_code, name: 'radio', public_key: await freshPubkey() }),
    });
    expect(reg2.status).toBe(403);
    await reg2.text();
  });

  it('rejects registration under a different name than the invite', async () => {
    const invRes = await ownerFetch('POST', '/admin/invite', JSON.stringify({ name: 'radio' }));
    const { invite_code } = (await invRes.json()) as any;
    const res = await SELF.fetch('https://relay/register', {
      method: 'POST',
      body: JSON.stringify({ invite_code, name: 'imposter', public_key: await freshPubkey() }),
    });
    expect(res.status).toBe(403);
    await res.text();
  });

  it('rejects a bogus invite code', async () => {
    const res = await SELF.fetch('https://relay/register', {
      method: 'POST',
      body: JSON.stringify({ invite_code: 'ffff', name: 'radio', public_key: await freshPubkey() }),
    });
    expect(res.status).toBe(403);
    await res.text();
  });

  it('rejects registration when the agent name already exists', async () => {
    await createAgent('radio');
    const invRes = await ownerFetch('POST', '/admin/invite', JSON.stringify({ name: 'radio' }));
    const { invite_code } = (await invRes.json()) as any;
    const res = await SELF.fetch('https://relay/register', {
      method: 'POST',
      body: JSON.stringify({ invite_code, name: 'radio', public_key: await freshPubkey() }),
    });
    expect(res.status).toBe(409);
    await res.text();
  });

  it('validates names and public keys', async () => {
    const badName = await ownerFetch('POST', '/admin/invite', JSON.stringify({ name: 'Bad_Name!' }));
    expect(badName.status).toBe(400);
    await badName.text();
    const invRes = await ownerFetch('POST', '/admin/invite', JSON.stringify({ name: 'radio' }));
    const { invite_code } = (await invRes.json()) as any;
    const badKey = await SELF.fetch('https://relay/register', {
      method: 'POST',
      body: JSON.stringify({ invite_code, name: 'radio', public_key: 'tooshort' }),
    });
    expect(badKey.status).toBe(400);
    await badKey.text();
  });
});
