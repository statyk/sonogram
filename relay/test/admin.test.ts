import { describe, it, expect } from 'vitest';
import { createAgent, ownerFetch } from './helpers';

describe('channels', () => {
  it('owner creates a channel; members can send and read; non-members cannot', async () => {
    const radio = await createAgent('radio');
    const llama = await createAgent('llama');
    const outsider = await createAgent('outsider');

    const createRes = await ownerFetch(
      'POST',
      '/admin/channel',
      JSON.stringify({ name: 'coord', members: ['owner', 'radio', 'llama'] }),
    );
    expect(createRes.status).toBe(200);
    await createRes.text();

    const sendRes = await radio.fetch('POST', '/send', JSON.stringify({ target: '#coord', body: 'sync?' }));
    expect(sendRes.status).toBe(200);
    await sendRes.text();

    const readRes = await llama.fetch('GET', '/read?target=%23coord');
    expect(readRes.status).toBe(200);
    const { messages } = (await readRes.json()) as any;
    expect(messages).toHaveLength(1);
    expect(messages[0].from).toBe('radio');
    expect(messages[0].target).toBe('#coord');

    const outsiderSend = await outsider.fetch('POST', '/send', JSON.stringify({ target: '#coord', body: 'hi' }));
    expect(outsiderSend.status).toBe(403);
    await outsiderSend.text();

    const outsiderRead = await outsider.fetch('GET', '/read?target=%23coord');
    expect(outsiderRead.status).toBe(403);
    await outsiderRead.text();

    const statusRes = await llama.fetch('GET', '/status');
    const status = (await statusRes.json()) as any;
    expect(status.channels).toEqual(['#coord']);
    expect(status.unread['#coord']).toBe(1);
  });

  it('rejects channel creation by non-owners, dup channels, and unknown members', async () => {
    const radio = await createAgent('radio');

    const nonOwnerRes = await radio.fetch('POST', '/admin/channel', JSON.stringify({ name: 'x', members: ['radio'] }));
    expect(nonOwnerRes.status).toBe(403);
    await nonOwnerRes.text();

    const unknownMemberRes = await ownerFetch(
      'POST',
      '/admin/channel',
      JSON.stringify({ name: 'coord', members: ['ghost'] }),
    );
    expect(unknownMemberRes.status).toBe(400);
    await unknownMemberRes.text();

    const firstCreate = await ownerFetch(
      'POST',
      '/admin/channel',
      JSON.stringify({ name: 'coord', members: ['owner'] }),
    );
    await firstCreate.text();

    const dupRes = await ownerFetch(
      'POST',
      '/admin/channel',
      JSON.stringify({ name: 'coord', members: ['owner'] }),
    );
    expect(dupRes.status).toBe(409);
    await dupRes.text();
  });

  it('404s sends to unknown channels', async () => {
    const radio = await createAgent('radio');
    const res = await radio.fetch('POST', '/send', JSON.stringify({ target: '#nope', body: 'x' }));
    expect(res.status).toBe(404);
    await res.text();
  });
});

describe('revocation', () => {
  it('revoked agents are rejected everywhere', async () => {
    const radio = await createAgent('radio');
    const res = await ownerFetch('POST', '/admin/revoke', JSON.stringify({ name: 'radio' }));
    expect(res.status).toBe(200);
    await res.text();

    const statusRes = await radio.fetch('GET', '/status');
    expect(statusRes.status).toBe(403);
    await statusRes.text();

    const sendRes = await radio.fetch('POST', '/send', JSON.stringify({ target: 'owner', body: 'x' }));
    expect(sendRes.status).toBe(403);
    await sendRes.text();
  });

  it('cannot revoke the owner or unknown agents; non-owners cannot revoke', async () => {
    const radio = await createAgent('radio');

    const revokeOwnerRes = await ownerFetch('POST', '/admin/revoke', JSON.stringify({ name: 'owner' }));
    expect(revokeOwnerRes.status).toBe(400);
    await revokeOwnerRes.text();

    const revokeGhostRes = await ownerFetch('POST', '/admin/revoke', JSON.stringify({ name: 'ghost' }));
    expect(revokeGhostRes.status).toBe(404);
    await revokeGhostRes.text();

    const nonOwnerRevoke = await radio.fetch('POST', '/admin/revoke', JSON.stringify({ name: 'owner' }));
    expect(nonOwnerRevoke.status).toBe(403);
    await nonOwnerRevoke.text();
  });

  it('sends to a revoked agent 404', async () => {
    const radio = await createAgent('radio');
    const llama = await createAgent('llama');
    const revokeRes = await ownerFetch('POST', '/admin/revoke', JSON.stringify({ name: 'radio' }));
    await revokeRes.text();

    const sendRes = await llama.fetch('POST', '/send', JSON.stringify({ target: 'radio', body: 'x' }));
    expect(sendRes.status).toBe(404);
    await sendRes.text();
  });
});
