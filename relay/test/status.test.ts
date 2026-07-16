import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { ownerFetch, ownerKey, signedFetch } from './helpers';

describe('GET /status', () => {
  it('rejects requests with no auth headers', async () => {
    const res = await SELF.fetch('https://relay/status');
    expect(res.status).toBe(401);
    await res.text();
  });

  it('rejects unknown agents', async () => {
    const res = await signedFetch('nobody', await ownerKey(), 'GET', '/status');
    expect(res.status).toBe(401);
    await res.text();
  });

  it('rejects a bad signature', async () => {
    const res = await SELF.fetch('https://relay/status', {
      headers: {
        'x-sonogram-agent': 'owner',
        'x-sonogram-timestamp': new Date().toISOString(),
        'x-sonogram-signature': 'aW52YWxpZA==',
      },
    });
    expect(res.status).toBe(401);
    await res.text();
  });

  it('returns status for the bootstrapped owner', async () => {
    const res = await ownerFetch('GET', '/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.agent).toBe('owner');
    expect(body.is_owner).toBe(true);
    expect(body.agents).toEqual([{ name: 'owner', is_owner: true }]);
    expect(body.channels).toEqual([]);
    expect(body.unread).toEqual({});
  });

  it('404s unknown routes', async () => {
    const res = await ownerFetch('GET', '/nope');
    expect(res.status).toBe(404);
    await res.text();
  });
});
