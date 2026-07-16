import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import { OWNER_PUBKEY_B64 } from './test/fixtures';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { OWNER_NAME: 'owner', OWNER_PUBKEY: OWNER_PUBKEY_B64 },
        },
      },
    },
  },
});
