import { describe, it, expect } from 'vitest';
import { createAgent, ownerFetch } from './helpers';

describe('direct messages', () => {
  it('delivers a DM: send → status unread → read → cursor → read empty', async () => {
    const radio = await createAgent('radio');

    const sendRes = await radio.fetch(
      'POST',
      '/send',
      JSON.stringify({ target: 'owner', body: 'hello owner', subject: 'greetings', thread_id: 't1' }),
    );
    expect(sendRes.status).toBe(200);
    const { id } = (await sendRes.json()) as any;
    expect(id).toBeGreaterThan(0);

    const statusRes = await ownerFetch('GET', '/status');
    const status = (await statusRes.json()) as any;
    expect(status.unread.owner).toBe(1);

    const readRes = await ownerFetch('GET', '/read?target=owner');
    expect(readRes.status).toBe(200);
    const { messages } = (await readRes.json()) as any;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id, from: 'radio', target: 'owner', subject: 'greetings', thread_id: 't1', body: 'hello owner',
    });

    const curRes = await ownerFetch('POST', '/cursor', JSON.stringify({ target: 'owner', last_read: id }));
    expect(curRes.status).toBe(200);
    await curRes.json();

    const readAgain = await ownerFetch('GET', '/read?target=owner');
    expect(((await readAgain.json()) as any).messages).toHaveLength(0);

    const statusAfter = (await (await ownerFetch('GET', '/status')).json()) as any;
    expect(statusAfter.unread).toEqual({});
  });

  it('stamps from as the authenticated sender', async () => {
    const radio = await createAgent('radio');
    const sendRes = await radio.fetch(
      'POST',
      '/send',
      JSON.stringify({ target: 'owner', body: 'x', from: 'owner' }),
    );
    await sendRes.json();
    const { messages } = (await (await ownerFetch('GET', '/read?target=owner')).json()) as any;
    expect(messages[0].from).toBe('radio');
  });

  it('supports explicit since', async () => {
    const radio = await createAgent('radio');
    const r1 = await radio.fetch('POST', '/send', JSON.stringify({ target: 'owner', body: 'one' }));
    const id1 = ((await r1.json()) as any).id;
    const r2 = await radio.fetch('POST', '/send', JSON.stringify({ target: 'owner', body: 'two' }));
    await r2.json();
    const { messages } = (await (
      await ownerFetch('GET', `/read?target=owner&since=${id1}`)
    ).json()) as any;
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('two');
  });

  it("forbids reading another agent's inbox", async () => {
    const radio = await createAgent('radio');
    const res = await radio.fetch('GET', '/read?target=owner');
    expect(res.status).toBe(403);
    await res.json();
  });

  it('404s sends to unknown targets', async () => {
    const radio = await createAgent('radio');
    const res = await radio.fetch('POST', '/send', JSON.stringify({ target: 'ghost', body: 'x' }));
    expect(res.status).toBe(404);
    await res.json();
  });

  it('rejects oversized bodies', async () => {
    const radio = await createAgent('radio');
    const res = await radio.fetch(
      'POST',
      '/send',
      JSON.stringify({ target: 'owner', body: 'x'.repeat(64 * 1024 + 1) }),
    );
    expect(res.status).toBe(413);
    await res.json();
  });

  it('validates cursor payloads', async () => {
    const res = await ownerFetch('POST', '/cursor', JSON.stringify({ target: 'owner', last_read: -1 }));
    expect(res.status).toBe(400);
    await res.json();
  });

  it('rejects requests larger than the request-size guard with 413', async () => {
    const radio = await createAgent('radio');
    const oversized = JSON.stringify({ target: 'owner', last_read: 0, pad: 'x'.repeat(80 * 1024 + 1) });
    const res = await radio.fetch('POST', '/cursor', oversized);
    expect(res.status).toBe(413);
    await res.text();
  });

  it('rejects an over-length subject with 400', async () => {
    const radio = await createAgent('radio');
    const res = await radio.fetch(
      'POST',
      '/send',
      JSON.stringify({ target: 'owner', body: 'hi', subject: 'x'.repeat(257) }),
    );
    expect(res.status).toBe(400);
    await res.text();
  });

  it('rejects an over-length thread_id with 400', async () => {
    const radio = await createAgent('radio');
    const res = await radio.fetch(
      'POST',
      '/send',
      JSON.stringify({ target: 'owner', body: 'hi', thread_id: 'x'.repeat(257) }),
    );
    expect(res.status).toBe(400);
    await res.text();
  });
});
