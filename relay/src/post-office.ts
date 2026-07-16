import { DurableObject } from 'cloudflare:workers';
import type { Env } from './types';
import { verifySignature, sha256hex, b64decode } from './auth';
import { json, err, parseJson } from './http';

export const RETENTION_DAYS = 30;
export const MAX_BODY_BYTES = 64 * 1024;
export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AuthedAgent {
  agent: string;
  isOwner: boolean;
}

export class PostOffice extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.initSchema();
    });
  }

  private get sql() {
    return this.ctx.storage.sql;
  }

  private initSchema(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS agents (
      name TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      is_owner INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS invites (
      code_hash TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      redeemed_at INTEGER
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_agent TEXT NOT NULL,
      target TEXT NOT NULL,
      thread_id TEXT,
      subject TEXT,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS channels (
      name TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS channel_members (
      channel TEXT NOT NULL,
      agent TEXT NOT NULL,
      PRIMARY KEY (channel, agent)
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS cursors (
      agent TEXT NOT NULL,
      target TEXT NOT NULL,
      last_read INTEGER NOT NULL,
      PRIMARY KEY (agent, target)
    )`);
    if (this.env.OWNER_NAME && this.env.OWNER_PUBKEY) {
      this.sql.exec(
        `INSERT OR IGNORE INTO agents (name, public_key, is_owner, status, created_at)
         VALUES (?, ?, 1, 'active', ?)`,
        this.env.OWNER_NAME,
        this.env.OWNER_PUBKEY,
        Date.now(),
      );
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathWithQuery = url.pathname + url.search;
    const bodyBytes = new Uint8Array(await request.arrayBuffer());
    const route = `${request.method} ${url.pathname}`;

    if (route === 'POST /register') return this.handleRegister(bodyBytes);

    const auth = await this.authenticate(request, pathWithQuery, bodyBytes);
    if (auth instanceof Response) return auth;

    switch (route) {
      case 'GET /status':
        return this.handleStatus(auth);
      case 'POST /admin/invite':
        return this.requireOwner(auth) ?? this.handleInvite(bodyBytes);
      default:
        return err(404, 'not found');
    }
  }

  private async authenticate(
    request: Request,
    pathWithQuery: string,
    bodyBytes: Uint8Array,
  ): Promise<AuthedAgent | Response> {
    const agent = request.headers.get('x-sonogram-agent');
    const timestamp = request.headers.get('x-sonogram-timestamp');
    const signature = request.headers.get('x-sonogram-signature');
    if (!agent || !timestamp || !signature) return err(401, 'missing auth headers');

    const row = this.sql
      .exec('SELECT public_key, is_owner, status FROM agents WHERE name = ?', agent)
      .toArray()[0];
    if (!row) return err(401, 'unknown agent');
    if (row.status !== 'active') return err(403, 'agent revoked');

    const result = await verifySignature({
      publicKeyB64: row.public_key as string,
      signatureB64: signature,
      timestamp,
      method: request.method,
      pathWithQuery,
      body: bodyBytes,
    });
    if (!result.ok) return err(401, result.error ?? 'unauthorized');

    return { agent, isOwner: row.is_owner === 1 };
  }

  private requireOwner(auth: AuthedAgent): Response | null {
    return auth.isOwner ? null : err(403, 'owner only');
  }

  private cursorFor(agent: string, target: string): number {
    const row = this.sql
      .exec('SELECT last_read FROM cursors WHERE agent = ? AND target = ?', agent, target)
      .toArray()[0];
    return row ? Number(row.last_read) : 0;
  }

  private unreadCount(agent: string, target: string): number {
    const since = this.cursorFor(agent, target);
    const row = this.sql
      .exec('SELECT COUNT(*) AS n FROM messages WHERE target = ? AND id > ?', target, since)
      .one();
    return Number(row.n);
  }

  private myChannels(agent: string): string[] {
    return this.sql
      .exec('SELECT channel FROM channel_members WHERE agent = ? ORDER BY channel', agent)
      .toArray()
      .map((r) => '#' + (r.channel as string));
  }

  private handleStatus(auth: AuthedAgent): Response {
    const agents = this.sql
      .exec("SELECT name, is_owner FROM agents WHERE status = 'active' ORDER BY name")
      .toArray()
      .map((r) => ({ name: r.name as string, is_owner: r.is_owner === 1 }));
    const channels = this.myChannels(auth.agent);
    const unread: Record<string, number> = {};
    const inbox = this.unreadCount(auth.agent, auth.agent);
    if (inbox > 0) unread[auth.agent] = inbox;
    for (const ch of channels) {
      const n = this.unreadCount(auth.agent, ch);
      if (n > 0) unread[ch] = n;
    }
    return json({ agent: auth.agent, is_owner: auth.isOwner, agents, channels, unread });
  }

  private async handleInvite(bodyBytes: Uint8Array): Promise<Response> {
    const body = parseJson(bodyBytes);
    if (!body || typeof body.name !== 'string') return err(400, 'name required');
    if (!NAME_RE.test(body.name)) return err(400, 'invalid name (lowercase letters, digits, hyphens; max 32)');
    const code = randomHex(16);
    const codeHash = await sha256hex(new TextEncoder().encode(code));
    this.sql.exec(
      'INSERT OR REPLACE INTO invites (code_hash, name, created_at, redeemed_at) VALUES (?, ?, ?, NULL)',
      codeHash,
      body.name,
      Date.now(),
    );
    return json({ invite_code: code, name: body.name });
  }

  private async handleRegister(bodyBytes: Uint8Array): Promise<Response> {
    const body = parseJson(bodyBytes);
    if (
      !body ||
      typeof body.invite_code !== 'string' ||
      typeof body.name !== 'string' ||
      typeof body.public_key !== 'string'
    ) {
      return err(400, 'invite_code, name, public_key required');
    }
    if (!NAME_RE.test(body.name)) return err(400, 'invalid name');
    let keyBytes: Uint8Array;
    try {
      keyBytes = b64decode(body.public_key);
    } catch {
      return err(400, 'public_key must be base64');
    }
    if (keyBytes.length !== 32) return err(400, 'public_key must be 32 raw Ed25519 bytes, base64-encoded');

    const codeHash = await sha256hex(new TextEncoder().encode(body.invite_code));
    const invite = this.sql
      .exec('SELECT name FROM invites WHERE code_hash = ? AND redeemed_at IS NULL', codeHash)
      .toArray()[0];
    if (!invite || invite.name !== body.name) return err(403, 'invalid or redeemed invite');

    const existing = this.sql.exec('SELECT 1 FROM agents WHERE name = ?', body.name).toArray()[0];
    if (existing) return err(409, 'agent already exists');

    this.sql.exec(
      `INSERT INTO agents (name, public_key, is_owner, status, created_at) VALUES (?, ?, 0, 'active', ?)`,
      body.name,
      body.public_key,
      Date.now(),
    );
    this.sql.exec('UPDATE invites SET redeemed_at = ? WHERE code_hash = ?', Date.now(), codeHash);
    return json({ ok: true, name: body.name });
  }
}

function randomHex(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
