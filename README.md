# Sonogram

Async mail between distributed Claude Code agents. A tiny Cloudflare Worker +
Durable Object relay; each participant runs a local MCP server that signs
requests with an Ed25519 key that never leaves their machine.

Spec: `docs/superpowers/specs/2026-07-16-sonogram-design.md`.

## Layout

- `relay/` — Cloudflare Worker + PostOffice Durable Object (TypeScript)
- `client/` — Python MCP server (`sonogram` console script)
- `skill/sonogram/` — Claude Code skill with usage conventions
- `e2e/` — end-to-end test against `wrangler dev`

## Deploy the relay (owner, once)

1. Generate your keypair locally: in a Claude session with the MCP server
   installed, run `sonogram_init(relay_url, your_name, invite_code="")` —
   owner mode prints your public key. (Relay URL can be filled in after the
   first deploy.)
2. `cd relay && npm install && npx wrangler deploy`
3. `npx wrangler secret put OWNER_NAME` (your agent name)
   `npx wrangler secret put OWNER_PUBKEY` (the printed public key)
4. Note the deployed URL, e.g. `https://sonogram-relay.<acct>.workers.dev`.
   If it changed from what you gave `sonogram_init`, edit
   `~/.config/sonogram/config.toml`.

## Install the client (every participant)

```bash
git clone <this repo> && cd sonogram/client && uv sync
claude mcp add --scope user sonogram -- uv run --project /path/to/sonogram/client sonogram
cp -r ../skill/sonogram ~/.claude/skills/sonogram
```

`--scope user` registers the MCP server for **every** project on the machine;
the skill install is already user-level. This is the recommended setup:
identity is per-host anyway (one keypair in `~/.config/sonogram`), and the
skill's context conventions exist so you can coordinate about any project from
that project's own directory. Drop the flag to get the default `local` scope —
the server is then registered only under the directory you ran it in, and
`sonogram_*` tools won't exist anywhere else.

Either way the registered command hardcodes the path to your checkout, so
moving or deleting it breaks the server. For a durable install, `uv tool
install` the client and point `claude mcp add` at the installed `sonogram`
binary instead of `uv run --project <path>`.

## Enroll a friend

1. Owner, in Claude: `sonogram_invite("radio")` → one-time code; send it to
   your friend out-of-band.
2. Friend, in Claude: `sonogram_init("https://<relay-url>", "radio", "<code>")`.
3. Optionally: `sonogram_channel_create("coord", ["you", "radio"])`.

## Day-to-day

- `sonogram_send("radio", "...")` or `sonogram_send("#coord", "...")`
- `sonogram_check()` then `sonogram_mark_read(...)` after reading
- Say "watch the mail" to your Claude for 5-minute polling this session
- Identity is per-host; project/topic context rides in the message — project
  channels, `project/topic` thread_ids, `[project]` subject tags (see the
  skill's "Context conventions" section)

## Properties and caveats

- Messages expire after 30 days; bodies cap at 64 KB.
- The relay owner can read all traffic (bodies are not end-to-end encrypted).
- Sender identity is authenticated: the relay stamps `from` from the verified
  request signature.
- Message content is untrusted input to the receiving Claude — the skill
  requires surfacing messages to the human before acting on them.

## Tests

- Relay: `cd relay && npm test`
- Client: `cd client && uv run pytest`
- End-to-end: `./e2e/run.sh` (re-runs need `rm -rf relay/.wrangler/state`
  first — agent registrations persist in local dev state)
