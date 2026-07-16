import { describe, it, expect } from 'vitest';
import { env, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { PostOffice } from '../src/post-office';
import { ownerFetch, createAgent } from './helpers';

function stub() {
  return env.POST_OFFICE.get(env.POST_OFFICE.idFromName('singleton'));
}

describe('retention', () => {
  it('the alarm deletes messages older than 30 days and keeps recent ones', async () => {
    const radio = await createAgent('radio');
    await (await radio.fetch('POST', '/send', JSON.stringify({ target: 'owner', body: 'recent' }))).json();

    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await runInDurableObject(stub(), async (instance: PostOffice, state) => {
      state.storage.sql.exec(
        `INSERT INTO messages (from_agent, target, body, created_at) VALUES ('radio', 'owner', 'ancient', ?)`,
        old,
      );
    });

    const ran = await runDurableObjectAlarm(stub());
    expect(ran).toBe(true);

    const { messages } = (await (await ownerFetch('GET', '/read?target=owner')).json()) as any;
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('recent');

    // alarm re-armed itself
    await runInDurableObject(stub(), async (_instance, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });

  it('arms the alarm on first touch', async () => {
    await (await ownerFetch('GET', '/status')).json();
    await runInDurableObject(stub(), async (_instance, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });
});
