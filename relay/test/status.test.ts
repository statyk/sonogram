import { describe, it, expect } from 'vitest';
import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { PostOffice } from '../src/post-office';
import { OWNER_PUBKEY_B64 } from './fixtures';
import { ownerFetch, ownerKey, signedFetch } from './helpers';

function stub() {
  return env.POST_OFFICE.get(env.POST_OFFICE.idFromName('singleton'));
}

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

describe('owner bootstrap upsert', () => {
  it('reseeds a rotated owner key and demotes any stale owner', async () => {
    // Touch the DO so it exists and the schema is seeded.
    await (await ownerFetch('GET', '/status')).text();

    await runInDurableObject(stub(), async (instance: PostOffice, state) => {
      const sql = state.storage.sql;
      // (a) corrupt the real owner's key and plant a fake second owner.
      sql.exec("UPDATE agents SET public_key = 'stale' WHERE name = 'owner'");
      sql.exec(
        `INSERT INTO agents (name, public_key, is_owner, status, created_at)
         VALUES ('impostor', 'fakekey', 1, 'active', ?)`,
        Date.now(),
      );

      // (b) re-run the seed.
      (instance as any).initSchema();

      // (c) owner key is restored from the env binding; the fake owner is demoted.
      const owner = sql
        .exec("SELECT public_key, is_owner FROM agents WHERE name = 'owner'")
        .toArray()[0];
      expect(owner.public_key).toBe(OWNER_PUBKEY_B64);
      expect(owner.is_owner).toBe(1);
      const impostor = sql
        .exec("SELECT is_owner FROM agents WHERE name = 'impostor'")
        .toArray()[0];
      expect(impostor.is_owner).toBe(0);
    });
  });
});
